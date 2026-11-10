import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapshot } from './release/source.mjs'

// 只准备可审阅的本地产物，签名摘要用于保护已有安装的覆盖升级能力。
const root = fileURLToPath(new URL('..', import.meta.url))
const before = await snapshot(root)
execFileSync('pnpm', ['android:build'], { cwd: root, stdio: 'inherit' })
assert.equal((await snapshot(root)).fingerprint, before.fingerprint, '构建期间源码变化，请重新打包')
const source = resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk')
const output = resolve(root, 'artifacts')
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
assert.ok(sdk, '请设置 ANDROID_HOME 或 ANDROID_SDK_ROOT')
const versions = (await readdir(resolve(sdk, 'build-tools'))).filter(name => /^\d+\.\d+\.\d+$/.test(name)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
assert.ok(versions.length, '未找到 Android Build Tools')
const buildTools = resolve(sdk, 'build-tools', versions[0])
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim()
const badging = run(resolve(buildTools, 'aapt'), ['dump', 'badging', source])
const packageInfo = /^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m.exec(badging)
assert.ok(packageInfo, '无法读取 APK 包信息')
assert.equal(packageInfo[1], 'app.ohmylife.record', 'APK 应用标识发生变化')
assert.equal(/^application-label:'([^']+)'/m.exec(badging)?.[1], 'OhMyLife', 'APK 应用名必须是 OhMyLife')
assert.match(badging, /^application-debuggable/m, '个人使用候选包应为已验证的 debug 构建')
const signed = run(resolve(buildTools, 'apksigner'), ['verify', '--print-certs', source])
const certificate = /^Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})$/m.exec(signed)?.[1]
assert.ok(certificate, '无法验证 APK 签名')
assert.equal(certificate, (await readFile(resolve(root, 'android/signing-certificate.sha256'), 'utf8')).trim(), '签名与已有版本不一致，请恢复原密钥')

const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, '候选版本必须为稳定的三段版本号')
assert.equal(packageInfo[3], pkg.version, 'APK 版本与 package.json 不一致，请重新构建')
const body = await readFile(source)
const sha256 = createHash('sha256').update(body).digest('hex')
const filename = `OhMyLife-v${pkg.version}.apk`
const metadata = {
  version: pkg.version, tag: 'v' + pkg.version, appName: 'OhMyLife', applicationId: packageInfo[1],
  versionCode: Number(packageInfo[2]), versionName: packageInfo[3], buildType: 'debug',
  apk: { file: filename, bytes: body.length, sha256 }, signingCertificateSha256: certificate,
  baseCommit: before.head, sourceDirty: before.changes.length > 0,
  sourceFingerprint: before.fingerprint, approval: 'pending',
  plannedDownloadUrl: `https://github.com/GStarP/oh-my-life-record/releases/download/v${pkg.version}/${filename}`,
}
const notes = `# OhMyLife ${metadata.tag}\n\n- Android 离线生活记录，SQLite 与图片本体完整保存在设备中。\n- 手动 S3/R2 整库备份与恢复，支持缺图传输、删除对齐及中断后继续。\n- 原生选图、预览与保存；最长边 2048px、WebP 质量 80。\n- 应用显示名为 OhMyLife，图标保留比例留白，连接页使用右上角关闭。\n- 类型模板按创建时间排序，编辑保留位置。\n\n个人使用 debug 包，沿用现有签名，可直接覆盖安装。\n`
await mkdir(output, { recursive: true })
await copyFile(source, resolve(output, filename))
await writeFile(resolve(output, filename + '.sha256'), `${sha256}  ${filename}\n`)
await writeFile(resolve(output, 'release.json'), JSON.stringify(metadata, null, 2) + '\n')
await writeFile(resolve(output, 'release-notes.md'), notes)
console.log(JSON.stringify(metadata, null, 2))
console.log('本地候选包已准备；发布须经用户逐版本审核确认。')
