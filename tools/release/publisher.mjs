import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { digest, repository, remoteUrl, run, snapshot, verify } from './source.mjs'

const gitTransport = ['-c', 'core.sshCommand=ssh -oBatchMode=yes -oConnectTimeout=15']
export async function authentication(root) {
  try {
    await run(root, 'gh', ['auth', 'status', '--hostname', 'github.com'])
    const [login, id] = (await run(root, 'gh', ['api', 'user', '--jq', '[.login,.id] | @tsv'])).split('\t')
    assert.match(login, /^[A-Za-z0-9-]+$/); assert.match(id, /^\d+$/)
    return { ready: true, login, author: `${login} <${id}+${login}@users.noreply.github.com>` }
  } catch { return { ready: false, message: '先在终端运行 gh auth login --web，再点击刷新检查。' } }
}
export async function remoteState(root, tag) {
  const refs = await run(root, 'git', [...gitTransport, 'ls-remote', remoteUrl, 'refs/heads/main', 'refs/tags/' + tag], { timeout: 20_000 })
  const entries = Object.fromEntries(refs.split('\n').filter(Boolean).map(line => { const [oid, ref] = line.split(/\s+/); return [ref, oid] }))
  assert.ok(entries['refs/heads/main'], '未找到远端 main 分支')
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OhMyLife-release-review' }, signal: AbortSignal.timeout(15_000), redirect: 'error' })
  assert.ok(response.ok || response.status === 404, '无法核对 GitHub Release：HTTP ' + response.status)
  const release = response.ok ? await response.json() : undefined
  // 按标签查询只用于检查已发布版本；草稿由 readRelease 通过 CLI 读取。
  return { main: entries['refs/heads/main'], tag: entries['refs/tags/' + tag] ?? null, localTag: await run(root, 'git', ['rev-parse', '--verify', 'refs/tags/' + tag]).catch(() => null), release: release ? { id: release.id, draft: release.draft, body: release.body } : null }
}
/** 按版本读取用户可访问的发布信息，包含尚未发布的草稿。 */
export async function readRelease(root, tag) {
  try {
    const release = JSON.parse(await run(root, 'gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft,body,assets,url']))
    return { draft: release.isDraft, body: release.body, assets: release.assets, html_url: release.url }
  } catch (error) { if (error.stderr?.trim() === 'release not found') return undefined; throw error }
}
export async function publish(root, approved, reviewedRemote, auth, log) {
  await verify(root, approved)
  assert.deepEqual(await authentication(root), auth, 'GitHub 登录身份已变化，请重新打开审核页')
  assert.ok(auth.ready, 'GitHub CLI 尚未登录')
  assert.deepEqual(await remoteState(root, approved.tag), reviewedRemote, '远端或标签已变化，请重新审核')
  let release = await readRelease(root, approved.tag)
  assert.ok(!release || release.draft, '该版本已经发布，不能覆盖，请提升版本号')
  assert.ok(!release || release.body === approved.notes, '已有草稿的说明不同，请检查后重新审核')
  await run(root, 'git', ['merge-base', '--is-ancestor', reviewedRemote.main, approved.current.head])
  log('固定已审核源码')
  await run(root, 'git', ['add', '-A', '--', '.'])
  const stagedTree = await run(root, 'git', ['write-tree'])
  assert.equal((await snapshot(root)).fingerprint, approved.sourceFingerprint, '提交前源码发生变化')
  const headTree = await run(root, 'git', ['rev-parse', 'HEAD^{tree}'])
  if (stagedTree !== headTree) {
    await run(root, 'git', ['-c', 'user.name=' + auth.login, '-c', 'user.email=' + auth.author.match(/<([^>]+)>/)[1], 'commit', '-m', 'Release OhMyLife ' + approved.tag], { env: { ...process.env, GIT_AUTHOR_NAME: auth.login, GIT_AUTHOR_EMAIL: auth.author.match(/<([^>]+)>/)[1], GIT_COMMITTER_NAME: auth.login, GIT_COMMITTER_EMAIL: auth.author.match(/<([^>]+)>/)[1] } })
  }
  const commit = await run(root, 'git', ['rev-parse', 'HEAD'])
  assert.equal(await run(root, 'git', ['rev-parse', 'HEAD^{tree}']), stagedTree, '提交钩子改变了源码，请重新构建审核')
  assert.equal((await snapshot(root)).fingerprint, approved.sourceFingerprint, '提交期间源码发生变化')
  release = await readRelease(root, approved.tag)
  assert.ok(!release || (release.draft && release.body === approved.notes), '发布状态已变化，停止推送标签')
  await run(root, 'git', ['tag', '--force', approved.tag, commit])
  log('推送源码与版本标签')
  const lease = `--force-with-lease=refs/tags/${approved.tag}:${reviewedRemote.tag ?? ''}`
  await run(root, 'git', [...gitTransport, 'push', '--atomic', lease, remoteUrl, `${commit}:refs/heads/main`, `refs/tags/${approved.tag}`])
  // 精确租约只允许调整审核过的标签；main 始终要求快进，两个引用原子推送。
  if (!release) {
    log('创建已批准的发布草稿')
    await run(root, 'gh', ['release', 'create', approved.tag, '--repo', repository, '--draft', '--verify-tag', '--title', 'OhMyLife ' + approved.tag, '--notes-file', resolve(approved.destination, 'release-notes.md')])
    release = await readRelease(root, approved.tag)
  } else log('继续已有发布草稿')
  assert.ok(release?.draft && release.body === approved.notes, '草稿不匹配，停止上传')
  const assets = [approved.apk.file, approved.apk.file + '.sha256']
  assert.ok(release.assets.every(asset => assets.includes(asset.name)), '草稿含有未审核附件')
  const verification = resolve(approved.destination, 'downloaded')
  await mkdir(verification, { recursive: true })
  for (const name of assets) {
    log(name === approved.apk.file ? '上传并核对安装包' : '上传并核对校验文件')
    if (!release.assets.some(asset => asset.name === name)) await run(root, 'gh', ['release', 'upload', approved.tag, resolve(approved.destination, name), '--repo', repository])
    await rm(resolve(verification, name), { force: true })
    await run(root, 'gh', ['release', 'download', approved.tag, '--repo', repository, '--pattern', name, '--dir', verification])
    assert.equal(digest(await readFile(resolve(verification, name))), digest(await readFile(resolve(approved.destination, name))), '已上传附件摘要不同，保留草稿并停止')
  }
  log('发布 GitHub Release')
  await run(root, 'gh', ['release', 'edit', approved.tag, '--repo', repository, '--draft=false', '--latest'])
  const published = await readRelease(root, approved.tag)
  assert.ok(published && !published.draft)
  await writeFile(resolve(approved.destination, 'result.json'), JSON.stringify({ commit, tag: approved.tag, apk: approved.apk, url: published.html_url, publishedAt: new Date().toISOString() }, null, 2))
  return published.html_url
}
