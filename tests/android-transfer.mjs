import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { connectAndroid, native, adb } from './helpers/android.mjs'

const appId = 'app.ohmylife.record'
async function listen(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve))
  return { server, url: 'http://10.0.2.2:' + server.address().port, close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) } }
}
function pss() {
  const text = adb('shell', 'dumpsys', 'meminfo', appId)
  const value = Number(/TOTAL PSS:\s*(\d+)/.exec(text)?.[1])
  assert.ok(value > 0, '必须读到 Android 进程 PSS')
  return value
}

test('64 个 16 MiB 文件以并发 2 完成 1 GiB 下载及上传，内存保持有界', { timeout: 300_000 }, async (t) => {
  // 服务端重复发送固定小缓冲区，客户端通过原生文件流读写累计 1 GiB 文件。
  // 每个文件校验摘要后再上传；测量原生进程 PSS，确认不会把整个数据集送入 JS 或 Java 堆。
  const app = await connectAndroid(), id = randomUUID(), size = 16 * 1024 * 1024, chunk = Buffer.alloc(65536, 90)
  const hash = createHash('sha256'); for (let i = 0; i < size / chunk.length; i++) hash.update(chunk)
  const sha256 = hash.digest('hex'); let received = 0
  const fixture = await listen(async (request, response) => {
    if (request.method === 'PUT') {
      const digest = createHash('sha256'); let bytes = 0
      for await (const piece of request) { digest.update(piece); bytes += piece.length }
      assert.equal(bytes, size); assert.equal(digest.digest('hex'), sha256); received += bytes
      response.writeHead(200).end(); return
    }
    response.writeHead(200, { 'content-length': size, 'content-type': 'application/octet-stream' })
    for (let sent = 0; sent < size; sent += chunk.length) if (!response.write(chunk)) await once(response, 'drain')
    response.end()
  })
  t.after(async () => {
    try { await native(app.page, 'endSync', { operationId: id }); adb('shell', 'run-as', appId, 'rm', '-rf', 'files/transfers/' + id) }
    finally { await app.close(); await fixture.close() }
  })
  assert.ok((await native(app.page, 'availableSpace')).bytes > 1200 * 1024 * 1024)
  const initial = pss(); let peak = initial, next = 0, completed = 0
  await native(app.page, 'beginSync', { operationId: id })
  await Promise.all([0, 1].map(async () => {
    while (next < 64) {
      const index = next++, path = 'transfers/' + id + '/image-' + index
      const file = (await native(app.page, 'network', { url: fixture.url + '/image-' + index, method: 'GET', destination: path, expectedSha256: sha256, operationId: id, key: path })).file
      assert.equal(file.bytes, size); assert.equal(file.sha256, sha256)
      assert.equal((await native(app.page, 'network', { url: fixture.url + '/image-' + index, method: 'PUT', source: path, operationId: id, key: path })).status, 200)
      completed++
      if (completed % 8 === 0) { peak = Math.max(peak, pss()); console.log(`已传输 ${completed}/64，原生 PSS ${(peak / 1024).toFixed(1)} MiB`) }
    }
  }))
  assert.equal(received, 1024 ** 3)
  assert.ok(peak - initial < 128 * 1024, `PSS 增量 ${(peak - initial) / 1024} MiB 必须小于 128 MiB`)
  console.log(`1 GiB 下载及上传完成；PSS 起点 ${(initial / 1024).toFixed(1)} MiB，峰值 ${(peak / 1024).toFixed(1)} MiB`)
})

test('网络停止接收后触发 15 秒空闲超时，未完成文件不成为可复用文件', { timeout: 30_000 }, async (t) => {
  // 连接正常但正文停止前进是最容易无限卡住的情况。保留未结束的响应，
  // 验证原生读取自行超时；释放会话后业务写入恢复，下载目标仍不存在。
  const app = await connectAndroid(), id = randomUUID(), path = 'transfers/' + id + '/stalled'
  const fixture = await listen((_, response) => { response.writeHead(200, { 'content-length': 1024 }); response.write('x') })
  t.after(async () => {
    try { await native(app.page, 'endSync', { operationId: id }); adb('shell', 'run-as', appId, 'rm', '-rf', 'files/transfers/' + id) }
    finally { await app.close(); await fixture.close() }
  })
  await native(app.page, 'beginSync', { operationId: id })
  const started = Date.now()
  await assert.rejects(native(app.page, 'network', { url: fixture.url + '/stall', method: 'GET', destination: path, operationId: id }), /timeout|超时/i)
  assert.ok(Date.now() - started >= 13_000 && Date.now() - started < 25_000)
  await native(app.page, 'endSync', { operationId: id })
  await native(app.page, 'execute', { statements: [] })
  assert.equal((await native(app.page, 'fileInfo', { path })).file, undefined)
})

test('元信息受 15 秒总时限约束，持续接收的文件可超过该时限', { timeout: 35_000 }, async (t) => {
  // 每秒接收一个字节，确保不会触发 15 秒读空闲超时。元信息请求仍须在约 15 秒终止，
  // 同时进行的 17 秒文件下载必须成功，证明统一网络时限不会误伤持续有进展的文件传输。
  const app = await connectAndroid(), id = randomUUID(), path = 'transfers/' + id + '/slow-file'
  const body = Buffer.alloc(17, 120), sha256 = createHash('sha256').update(body).digest('hex')
  const fixture = await listen((request, response) => {
    const size = request.url === '/file' ? 17 : 128
    response.writeHead(200, { 'content-length': size })
    let sent = 0
    const timer = setInterval(() => {
      response.write('x')
      if (++sent === size) { clearInterval(timer); response.end() }
    }, 1000)
    response.on('close', () => clearInterval(timer))
  })
  t.after(async () => {
    try { await native(app.page, 'endSync', { operationId: id }); adb('shell', 'run-as', appId, 'rm', '-rf', 'files/transfers/' + id) }
    finally { await app.close(); await fixture.close() }
  })
  await native(app.page, 'beginSync', { operationId: id })
  const started = Date.now()
  let metadataElapsed = 0
  const metadata = assert.rejects(native(app.page, 'network', { url: fixture.url + '/metadata', method: 'GET', operationId: id }), /timeout|超时/i).then(() => { metadataElapsed = Date.now() - started })
  const download = native(app.page, 'network', { url: fixture.url + '/file', method: 'GET', destination: path, expectedSha256: sha256, operationId: id })
  const [, result] = await Promise.all([metadata, download])
  assert.ok(metadataElapsed >= 13_000 && metadataElapsed < 25_000)
  assert.ok(Date.now() - started >= 16_000)
  assert.equal(result.file.bytes, body.length)
  assert.equal(result.file.sha256, sha256)
})

test('前台会话持续亮屏，45 秒无活动保护会自动解除写入锁和亮屏标志', { timeout: 70_000 }, async (t) => {
  // 把模拟器熄屏时间改为 5 秒并关闭充电常亮，验证同步会话跨过该时间仍保持唤醒。
  // 随后不发送活动，让原生保护器自行失效；唤醒应用后验证可以写入，且不再持有亮屏标志。
  let app = await connectAndroid()
  const id = randomUUID()
  const screenOff = adb('shell', 'settings', 'get', 'system', 'screen_off_timeout')
  const stayOn = adb('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in')
  t.after(async () => {
    adb('shell', 'settings', 'put', 'system', 'screen_off_timeout', screenOff)
    adb('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', stayOn)
    adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
    try { await native(app.page, 'endSync', { operationId: id }) } finally { await app.close() }
  })
  adb('shell', 'settings', 'put', 'system', 'screen_off_timeout', '5000')
  adb('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '0')
  await native(app.page, 'beginSync', { operationId: id })
  await assert.rejects(native(app.page, 'execute', { statements: [] }), /同步期间/)
  await app.close()
  await new Promise((resolve) => setTimeout(resolve, 7000))
  assert.match(adb('shell', 'dumpsys', 'power'), /mWakefulness=Awake/)
  assert.match(adb('shell', 'dumpsys', 'window'), /KEEP_SCREEN_ON/)
  await new Promise((resolve) => setTimeout(resolve, 44_000))
  assert.doesNotMatch(adb('shell', 'dumpsys', 'window'), /KEEP_SCREEN_ON/)
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
  app = await connectAndroid()
  await assert.rejects(native(app.page, 'execute', { operationId: id, statements: [] }), /已失效/)
  const nextId = randomUUID()
  await native(app.page, 'beginSync', { operationId: nextId })
  await native(app.page, 'endSync', { operationId: id })
  await assert.rejects(native(app.page, 'execute', { statements: [] }), /同步期间/)
  await native(app.page, 'endSync', { operationId: nextId })
  await native(app.page, 'execute', { statements: [] })
})
