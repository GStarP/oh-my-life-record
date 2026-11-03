import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { candidate, digest, repository, run, snapshot, verify } from '../tools/release/source.mjs'
import { authentication, remoteState, publish } from '../tools/release/publisher.mjs'
import { serveReview } from '../tools/release/server.mjs'

const fakeCandidate = { tag: 'v1.0.0', versionCode: 3, apk: { file: 'OhMyLife-v1.0.0.apk', bytes: 3, sha256: 'abc' }, current: { branch: 'codex/test', head: 'base', changes: 'M app' }, notes: '<script>不执行</script>', destination: '/private/local-only' }
async function review(t, options = {}) {
  const session = await serveReview({ approved: fakeCandidate, remote: { main: 'base', tag: null, localTag: null, release: null }, repository, authenticate: async () => ({ ready: true, login: 'test' }), publish: async () => 'https://example.com/release', ...options })
  t.after(session.close)
  const headers = { 'X-Review-Token': session.token, Origin: session.origin, 'Content-Type': 'application/json' }
  return { session, call: (path, body, override = {}) => fetch(session.origin + path, { method: body ? 'POST' : 'GET', headers: { ...headers, ...override }, body: body ? JSON.stringify(body) : undefined }) }
}

test('审核取消退出；无令牌和跨站请求不能发布', async t => {
  // 发布必须由本机页面的持有者明确触发，其他网页不能借用本机服务。
  // 取消后必须关闭服务器，并且发布函数一次都不调用，保证取消没有外部副作用。
  let calls = 0, closed
  const ended = new Promise(resolve => { closed = resolve })
  const { session, call } = await review(t, { publish: async () => { calls++ }, onClose: closed })
  assert.equal((await fetch(session.origin + '/state')).status, 403)
  assert.equal((await call('/confirm', {}, { Origin: 'https://example.com' })).status, 403)
  assert.equal((await call('/state')).status, 200)
  const value = await (await call('/state')).json()
  assert.equal(value.approved.destination, undefined)
  assert.equal((await call('/cancel', {})).status, 200)
  await ended
  assert.equal(calls, 0)
  await assert.rejects(fetch(session.origin + '/state'))
})

test('同名标签必须单独确认；重复点击只能发布一次', async t => {
  // 仓库已有未发布的同名标签时，普通确认不能重指向标签。
  // 用户勾选后才调用发布流程；双击或重复请求必须被拒绝，防止重复上传或发布。
  let calls = 0, finish
  const done = new Promise(resolve => { finish = resolve })
  const { session, call } = await review(t, { remote: { main: 'base', tag: 'old', localTag: 'old', release: null }, publish: async () => { calls++; await done; return 'https://example.com/release' } })
  t.after(() => finish())
  const page = await fetch(session.url)
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.match(await page.text(), /确认发布/)
  await call('/auth')
  assert.equal((await call('/confirm', {})).status, 400)
  assert.equal((await call('/confirm', { replaceTag: true })).status, 202)
  assert.equal((await call('/confirm', { replaceTag: true })).status, 409)
  assert.equal((await call('/cancel', {})).status, 409)
  assert.equal(calls, 1)
  finish()
})

async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'ohmylife-release-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = resolve(directory, 'source'), bare = resolve(directory, 'remote.git')
  await mkdir(root)
  await run(root, 'git', ['init', '-b', 'main'])
  await run(root, 'git', ['config', 'user.name', 'Test'])
  await run(root, 'git', ['config', 'user.email', 'test@example.invalid'])
  await writeFile(resolve(root, '.gitignore'), 'artifacts/\n.scratch/\n')
  await writeFile(resolve(root, 'application.txt'), 'base')
  await run(root, 'git', ['add', '.'])
  await run(root, 'git', ['commit', '-m', 'base'])
  await run(root, 'git', ['tag', '-a', 'v1.0.0', '-m', 'unpublished'])
  await run(directory, 'git', ['init', '--bare', bare])
  await run(root, 'git', ['config', `url.${bare}.insteadOf`, 'git@github.com:GStarP/oh-my-life-record.git'])
  await run(root, 'git', ['push', bare, 'main', 'v1.0.0'])
  const originalTag = await run(root, 'git', ['rev-parse', 'refs/tags/v1.0.0'])
  await writeFile(resolve(root, 'application.txt'), 'Android native source')
  await mkdir(resolve(root, 'artifacts'))
  const apk = Buffer.from('fixture APK bytes')
  const metadata = { version: '1.0.0', tag: 'v1.0.0', versionCode: 3, applicationId: 'app.ohmylife.record', approval: 'pending', apk: { file: 'OhMyLife-v1.0.0.apk', bytes: apk.length, sha256: digest(apk) }, sourceFingerprint: (await snapshot(root)).fingerprint }
  await writeFile(resolve(root, 'artifacts/release.json'), JSON.stringify(metadata))
  await writeFile(resolve(root, 'artifacts', metadata.apk.file), apk)
  await writeFile(resolve(root, 'artifacts', metadata.apk.file + '.sha256'), `${metadata.apk.sha256}  ${metadata.apk.file}\n`)
  await writeFile(resolve(root, 'artifacts/release-notes.md'), '# Android v1.0.0\n已审核说明\n')
  return { root, directory, bare, metadata, originalTag }
}

test('审核材料冻结：源码、APK 或说明改变时均拒绝发布', async t => {
  // 用户批准的是页面展示的具体内容。审核期间任何输入变化，都不能继续使用旧批准。
  // 用真实临时 Git 仓库分别改动三类输入，预期在任何提交和远端写入之前被拒绝。
  const { root } = await fixture(t)
  const index = await readFile(resolve(root, '.git/index'))
  const approved = await candidate(root, resolve(root, '.scratch/review'))
  assert.deepEqual(await readFile(resolve(root, '.git/index')), index, '准备审核不能修改索引')
  await verify(root, approved)
  for (const path of ['application.txt', 'artifacts/OhMyLife-v1.0.0.apk', 'artifacts/release-notes.md']) {
    const absolute = resolve(root, path), original = await readFile(absolute)
    await writeFile(absolute, 'changed')
    await assert.rejects(verify(root, approved), /变化/)
    await writeFile(absolute, original)
  }
  assert.equal(await run(root, 'git', ['log', '-1', '--format=%s']), 'base')
})

test('发布端到端：原子推送正确源码，附件中断保留草稿，重试核对后发布', async t => {
  // 此测试使用真实临时 Git 仓库和本地 bare 远端，GitHub CLI 与 HTTP 被隔离替身替代，
  // 因此绝不访问真实发布接口。第一次在摘要上传时中断，预期源码/标签正确且仅保留草稿；
  // 再次审核后复用正确 APK，上传剩余摘要并发布；已发布版本必须拒绝覆盖。
  const { root, directory, bare, metadata, originalTag } = await fixture(t)
  const bin = resolve(directory, 'bin'), statePath = resolve(directory, 'github.json')
  await mkdir(bin)
  const originalPath = process.env.PATH
  process.env.PATH = bin + ':' + originalPath
  t.after(() => { process.env.PATH = originalPath })
  await writeFile(statePath, JSON.stringify({ failChecksum: true, release: null, uploads: [] }))
  await writeFile(resolve(bin, 'gh'), `#!/usr/bin/env node
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';import { basename, resolve } from 'node:path';
const path=${JSON.stringify(statePath)},s=JSON.parse(readFileSync(path)),a=process.argv.slice(2),option=k=>a[a.indexOf(k)+1],save=()=>writeFileSync(path,JSON.stringify(s));
if(a[0]==='auth')process.exit(0);
if(a[0]==='api'){if(a[1]==='user')console.log('tester\\t123');else if(s.release)console.log(JSON.stringify(s.release));else{console.error('HTTP 404');process.exitCode=1}}
else if(a[1]==='create'){s.release={draft:true,body:readFileSync(option('--notes-file'),'utf8'),assets:[],html_url:'https://example.com/v1.0.0'};save()}
else if(a[1]==='upload'){const name=basename(a[3]);if(s.failChecksum&&name.endsWith('.sha256')){s.failChecksum=false;save();console.error('simulated interruption');process.exitCode=1}else{if(s.release.assets.some(x=>x.name===name))throw Error('duplicate upload');copyFileSync(a[3],resolve(${JSON.stringify(directory)},name));s.release.assets.push({name});s.uploads.push(name);save()}}
else if(a[1]==='download')copyFileSync(resolve(${JSON.stringify(directory)},option('--pattern')),resolve(option('--dir'),option('--pattern')));
else if(a[1]==='edit'){s.release.draft=false;save()}
else throw Error('unexpected gh invocation');
`)
  await chmod(resolve(bin, 'gh'), 0o700)
  mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), 'https://api.github.com/repos/GStarP/oh-my-life-record/releases/tags/v1.0.0')
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    return state.release && !state.release.draft ? Response.json(state.release) : new Response('', { status: 404 })
  })
  t.after(() => mock.restoreAll())
  const approved = await candidate(root, resolve(root, '.scratch/first'))
  const auth = await authentication(root), remote = await remoteState(root, approved.tag)
  assert.ok(auth.ready)
  await assert.rejects(publish(root, approved, remote, auth, () => {}), /Command failed/)
  const commit = await run(root, 'git', ['rev-parse', 'HEAD'])
  assert.notEqual(commit, approved.current.head)
  assert.equal(await run(directory, 'git', ['--git-dir=' + bare, 'rev-parse', 'refs/heads/main']), commit)
  assert.equal(await run(directory, 'git', ['--git-dir=' + bare, 'rev-parse', 'refs/tags/v1.0.0']), commit)
  assert.notEqual(commit, originalTag)
  assert.equal(await run(directory, 'git', ['--git-dir=' + bare, 'show', 'main:application.txt']), 'Android native source')
  assert.ok(JSON.parse(await readFile(statePath, 'utf8')).release.draft)
  const retry = await candidate(root, resolve(root, '.scratch/retry'))
  const url = await publish(root, retry, await remoteState(root, retry.tag), auth, () => {})
  assert.equal(url, 'https://example.com/v1.0.0')
  const result = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(result.release.draft, false)
  assert.deepEqual(result.uploads, [metadata.apk.file, metadata.apk.file + '.sha256'])
  assert.equal(digest(await readFile(resolve(directory, metadata.apk.file))), metadata.apk.sha256)
  const again = await candidate(root, resolve(root, '.scratch/again'))
  await assert.rejects(publish(root, again, await remoteState(root, again.tag), auth, () => {}), /已经发布/)
})
