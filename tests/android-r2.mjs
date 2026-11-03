import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { AwsClient } from 'aws4fetch'
import { connectAndroid, native, adb } from './helpers/android.mjs'

test('真实 R2：原生快照流式往返、元信息、条件提交与字节摘要', { timeout: 120_000 }, async (t) => {
  // 真实服务用随机隔离前缀，只上传模拟器快照。验证 Android 文件流和 S3 签名组合，
  // 特别检查条件写入是否拒绝覆盖，以及下载正文是否与原快照 SHA-256 完全一致。
  const id = randomUUID()
  const { R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_ACCESS_KEY_SECRET } = process.env
  assert.ok(R2_ENDPOINT && R2_BUCKET && R2_ACCESS_KEY_ID && R2_ACCESS_KEY_SECRET, '请配置隔离 R2 测试凭证')
  const base = new URL(R2_ENDPOINT.replace(/\/+$/, '') + '/' + encodeURIComponent(R2_BUCKET) + '/')
  assert.equal(base.protocol, 'https:')
  const root = '_android-smoke/' + id + '/'
  const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_ACCESS_KEY_SECRET, service: 's3', retries: 0 })
  const app = await connectAndroid(), key = 'database.sqlite'
  let attempted = false
  t.after(async () => {
    try {
      await native(app.page, 'endSync', { operationId: id })
      if (attempted) {
        const signed = await client.sign(new URL(root + key, base).toString(), { method: 'DELETE' })
        const response = await fetch(signed, { signal: AbortSignal.timeout(15_000), redirect: 'error' })
        assert.ok(response.ok, '隔离测试对象回收失败')
        await response.body?.cancel()
      }
      adb('shell', 'run-as', 'app.ohmylife.record', 'rm', '-rf', 'files/transfers/' + id)
    } finally { await app.close() }
  })
  await native(app.page, 'beginSync', { operationId: id })
  const file = await native(app.page, 'snapshot', { operationId: id })
  async function request(method, headers = {}, options = {}) {
    const signed = await client.sign(new URL(root + key, base).toString(), { method, headers: Object.fromEntries(Object.entries(headers).filter(([,value]) => value !== undefined)), aws: { signQuery: true } })
    return native(app.page, 'network', { method, url: signed.url, headers: Object.fromEntries(signed.headers), operationId: id, ...options })
  }
  const headers = { 'Content-Type': 'application/vnd.sqlite3', 'x-amz-meta-revision': '1', 'x-amz-meta-schema-version': '1', 'x-amz-meta-sha256': file.sha256, 'If-None-Match': '*' }
  attempted = true
  assert.equal((await request('PUT', headers, { source: file.path })).status, 200)
  assert.equal((await request('PUT', headers, { source: file.path })).status, 412)
  const head = await request('HEAD')
  assert.equal(head.status, 200); assert.equal(head.headers['x-amz-meta-sha256'], file.sha256); assert.equal(head.headers['x-amz-meta-schema-version'], '1')
  assert.equal(Number(head.headers['content-length']), file.bytes)
  assert.equal((await request('PUT', { ...headers, 'If-None-Match': undefined, 'If-Match': '"different"' }, { source: file.path })).status, 412)
  const downloaded = await request('GET', { 'If-Match': head.headers.etag }, { destination: 'transfers/' + id + '/download.sqlite', expectedSha256: file.sha256 })
  assert.equal(downloaded.status, 200); assert.equal(downloaded.file.sha256, file.sha256); assert.equal(downloaded.file.bytes, file.bytes)
  assert.equal((await native(app.page, 'query', { sql: 'PRAGMA integrity_check', values: [], path: downloaded.file.path })).rows[0].integrity_check, 'ok')
  console.log(`真实 R2 往返 ${file.bytes} 字节，摘要和元信息一致，条件覆盖已拒绝`)
})
