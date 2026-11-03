import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { adb } from './android.mjs'

/** 模拟 S3 条件写入和流式中断；只在模拟器可访问的本机端口提供合成数据。 */
export async function s3Server() {
  const objects = new Map(), requests = []
  let putGate, brokenImage, requestGate, requestKey, requestMethod
  const etag = (body) => '"' + createHash('sha256').update(body).digest('hex') + '"'
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost'), key = decodeURIComponent(url.pathname.slice('/bucket/'.length))
    const trace = { method: request.method, key }, started = Date.now()
    requests.push(trace)
    response.once('finish', () => { trace.status = response.statusCode; trace.durationMs = Date.now() - started })
    response.once('close', () => { if (!response.writableFinished) trace.closedEarly = true })
    if (request.method === requestMethod && key === requestKey && requestGate) await requestGate
    if (response.destroyed) return
    if (url.searchParams.has('list-type')) {
      const prefix = url.searchParams.get('prefix')
      response.writeHead(200, { 'content-type': 'application/xml' }).end('<ListBucketResult><IsTruncated>false</IsTruncated>' + [...objects].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => '<Contents><Key>' + encodeURIComponent(key) + '</Key><Size>' + value.body.length + '</Size></Contents>').join('') + '</ListBucketResult>'); return
    }
    const current = objects.get(key)
    if ((request.headers['if-none-match'] === '*' && current) || (request.headers['if-match'] && request.headers['if-match'] !== current?.headers.etag)) { response.writeHead(412).end(); return }
    if (request.method === 'PUT') {
      if (putGate && key.startsWith('data/images/')) await putGate
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = Buffer.concat(chunks), headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => key.startsWith('x-amz-meta-') || key === 'content-type'))
      headers.etag = etag(body); objects.set(key, { body, headers })
      response.writeHead(200, { etag: headers.etag }).end(); return
    }
    if (request.method === 'DELETE') { objects.delete(key); response.writeHead(204).end(); return }
    if (!current) { response.writeHead(404).end(); return }
    response.writeHead(200, { ...current.headers, 'content-length': current.body.length })
    if (request.method !== 'HEAD' && key === brokenImage) { response.write(current.body.subarray(0, 8)); setTimeout(() => response.destroy(), 10); return }
    response.end(request.method === 'HEAD' ? undefined : current.body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  // 通过 Android 调试通道访问本机服务，避免模拟器网关的连接抖动影响界面计时。
  try { adb('reverse', 'tcp:' + port, 'tcp:' + port) }
  catch (error) { await new Promise((resolve) => server.close(resolve)); throw error }
  return {
    objects, requests, endpoint: 'http://127.0.0.1:' + port,
    pauseImages() { let release; putGate = new Promise((resolve) => { release = resolve }); return () => { putGate = undefined; release() } },
    pauseRequest(method, key) { let release; requestMethod = method; requestKey = key; requestGate = new Promise((resolve) => { release = resolve }); return () => { requestMethod = undefined; requestKey = undefined; requestGate = undefined; release() } },
    breakImage(key) { brokenImage = key },
    setSnapshot(body, revision) { objects.set('data/database.sqlite', { body, headers: { etag: etag(body), 'content-type': 'application/vnd.sqlite3', 'x-amz-meta-schema-version': '1', 'x-amz-meta-revision': String(revision), 'x-amz-meta-sha256': createHash('sha256').update(body).digest('hex') } }) },
    close: async () => {
      server.closeAllConnections(); await new Promise((resolve) => server.close(resolve))
      try { adb('reverse', '--remove', 'tcp:' + port) } catch { /* 设备离线时调试通道随连接释放。 */ }
    },
  }
}
