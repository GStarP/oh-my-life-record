import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { lstat, readFile, readlink, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const execute = promisify(execFile)
export const repository = 'GStarP/oh-my-life-record'
export const remoteUrl = `git@github.com:${repository}.git`
export const digest = body => createHash('sha256').update(body).digest('hex')
export async function run(root, command, args, options = {}) {
  const { stdout } = await execute(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180_000, ...options })
  return stdout.trimEnd()
}
export async function snapshot(root) {
  const names = (await run(root, 'git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
  const hash = createHash('sha256')
  for (const name of [...new Set(names)].sort()) {
    const path = resolve(root, name)
    const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!info) continue
    assert.ok(info.isFile() || info.isSymbolicLink(), '源码中存在不支持的文件：' + name)
    hash.update(name).update('\0').update(info.isSymbolicLink() ? 'link' : String(info.mode & 0o111)).update('\0')
    hash.update(info.isSymbolicLink() ? await readlink(path) : await readFile(path)).update('\0')
  }
  return {
    fingerprint: hash.digest('hex'),
    head: await run(root, 'git', ['rev-parse', 'HEAD']),
    branch: await run(root, 'git', ['branch', '--show-current']),
    changes: await run(root, 'git', ['--no-optional-locks', '-c', 'core.quotePath=false', 'status', '--short', '--untracked-files=all']),
  }
}
export async function candidate(root, destination) {
  const metadata = JSON.parse(await readFile(resolve(root, 'artifacts/release.json'), 'utf8'))
  assert.match(metadata.version, /^\d+\.\d+\.\d+$/)
  assert.equal(metadata.tag, 'v' + metadata.version)
  assert.equal(metadata.apk.file, `OhMyLife-${metadata.tag}.apk`)
  assert.equal(metadata.applicationId, 'app.ohmylife.record')
  assert.equal(metadata.approval, 'pending')
  const current = await snapshot(root)
  assert.equal(current.fingerprint, metadata.sourceFingerprint, '源码已变化，请重新验证并打包')
  const body = await readFile(resolve(root, 'artifacts', metadata.apk.file))
  assert.equal(digest(body), metadata.apk.sha256, 'APK 已变化，请重新打包')
  assert.equal(body.length, metadata.apk.bytes)
  const notes = await readFile(resolve(root, 'artifacts/release-notes.md'), 'utf8')
  assert.ok(notes.trim(), '发布说明不能为空')
  const checksum = `${metadata.apk.sha256}  ${metadata.apk.file}\n`
  assert.equal(await readFile(resolve(root, 'artifacts', metadata.apk.file + '.sha256'), 'utf8'), checksum)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  await copyFile(resolve(root, 'artifacts', metadata.apk.file), resolve(destination, metadata.apk.file))
  await writeFile(resolve(destination, metadata.apk.file + '.sha256'), checksum, { mode: 0o600 })
  await writeFile(resolve(destination, 'release-notes.md'), notes, { mode: 0o600 })
  return { ...metadata, current, notes, notesSha256: digest(notes), destination }
}
export async function verify(root, approved) {
  const current = await snapshot(root)
  assert.equal(current.head, approved.current.head, '审核期间 HEAD 已变化，请重新打开审核页')
  assert.equal(current.fingerprint, approved.sourceFingerprint, '审核期间源码已变化，请重新打包')
  assert.equal(digest(await readFile(resolve(root, 'artifacts', approved.apk.file))), approved.apk.sha256, '审核期间 APK 已变化')
  assert.equal(digest(await readFile(resolve(root, 'artifacts/release-notes.md'))), approved.notesSha256, '审核期间发布说明已变化')
  assert.equal(digest(await readFile(resolve(approved.destination, approved.apk.file))), approved.apk.sha256, '冻结的 APK 校验失败')
}
