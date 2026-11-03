import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { connectAndroid, native, adb, writeAndroidFile } from './helpers/android.mjs'
import { s3Server } from './helpers/s3-server.mjs'
import { seedPhoto, pickPhoto } from './helpers/android-images.mjs'

const upload = pickPhoto
async function newRecord(page) { await page.getByRole('button', { name: '新建记录' }).click(); await page.getByText('自由', { exact: true }).click() }
async function closeToasts(page) {
  for (const close of await page.locator('[data-scope=toast] [data-part=close-trigger]').all()) await close.click()
}
async function synchronize(page, acceptConflict = false) {
  await closeToasts(page)
  await page.getByRole('button', { name: '手动同步' }).waitFor()
  await page.evaluate(() => {
    window.syncCompleted = new Promise((resolve) => {
      const button = document.querySelector('[aria-label="手动同步"]')
      let started = false
      const observer = new MutationObserver(() => {
        if (button.disabled) started = true
        else if (started) { observer.disconnect(); resolve() }
      })
      observer.observe(button, { attributes: true, attributeFilter: ['disabled'] })
    })
  })
  await page.getByRole('button', { name: '手动同步' }).click()
  if (acceptConflict) {
    const conflict = page.getByRole('dialog', { name: '发现云端冲突', exact: true })
    await conflict.waitFor()
    await conflict.getByRole('button', { name: '覆盖并同步', exact: true }).click()
  }
  await page.evaluate(() => window.syncCompleted)
}

test('Android 模板按创建时间排序且编辑、重启、快照恢复不改位置，云端配置可用右上角关闭', { timeout: 90_000 }, async (t) => {
  // 类型名刻意与创建顺序相反，通过真实编辑页、选择器、原生 SQLite 和快照往返检查顺序。
  // 编辑不能重写创建时间，新模板应追加；重启和恢复必须读取同一组时间，不能重新按语言排序。
  // 连接页仅保留一个连接动作，右上角关闭始终可见；请求进行中关闭后不能写入迟到的凭证。
  assert.match(adb('emu', 'avd', 'name'), /^Sync_UI/)
  let app = await connectAndroid(), page = app.page
  await page.reload(); await page.getByRole('link', { name: '记录', exact: true }).waitFor()
  const cloud = await s3Server(), names = ['Z-创建较早-', 'A-创建较晚-'].map(prefix => prefix + randomUUID().slice(0, 8))
  const keys = ['cloud-credential', 'cloud-credential-draft'], preferences = {}
  for (const key of keys) preferences[key] = (await native(page, 'readPreference', { key })).value
  let release = () => {}
  t.after(async () => {
    release()
    try {
      if (!page.isClosed()) {
        await page.evaluate(() => window.restoreConnectionBridge?.())
        await page.keyboard.press('Escape')
        for (const key of keys) await native(page, 'preference', { key, value: preferences[key] })
        await native(page, 'preference', { key: 'template-order-receipt', value: null })
        await native(page, 'execute', { statements: [{ sql: 'DELETE FROM type_templates WHERE type IN (?,?)', values: names }, { sql: 'UPDATE meta SET change_seq=change_seq+1' }] })
        await page.reload(); await page.getByRole('link', { name: '记录', exact: true }).click()
      }
    } finally { await app.close(); await cloud.close() }
  })
  const templates = async () => (await native(page, 'query', { sql: 'SELECT * FROM type_templates ORDER BY created_at,type', values: [] })).rows
  const baseline = await templates(), expected = [...baseline.map(row => row.type), ...names]
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '类型模板', exact: true }).click()
  for (const name of names) {
    await page.getByRole('button', { name: '添加', exact: true }).click()
    const editor = page.getByRole('dialog', { name: '新建类型模板', exact: true })
    await editor.getByRole('textbox', { name: '类型', exact: true }).fill(name)
    await editor.getByRole('button', { name: '保存', exact: true }).click()
    await editor.waitFor({ state: 'hidden' })
  }
  async function visibleOrder() {
    return (await page.getByRole('button').allTextContents()).map(text => text.trim()).filter(text => expected.includes(text))
  }
  assert.deepEqual(await visibleOrder(), expected)
  const created = await templates()
  assert.ok(created.at(-1).created_at >= Date.now() - 10_000)
  await page.getByRole('button', { name: names[0], exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑类型模板', exact: true })
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  assert.deepEqual(await visibleOrder(), expected)
  assert.deepEqual(await templates(), created)

  const operationId = randomUUID()
  await native(page, 'beginSync', { operationId })
  try {
    const snapshot = await native(page, 'snapshot', { operationId })
    const images = (await native(page, 'query', { sql: 'SELECT path FROM images', values: [] })).rows.map(row => row.path)
    await native(page, 'activate', { operationId, path: snapshot.path, images, receipt: { key: 'template-order-receipt', value: 'complete' } })
  } finally { await native(page, 'endSync', { operationId }) }
  await app.close()
  adb('shell', 'am', 'force-stop', 'app.ohmylife.record')
  app = await connectAndroid(); page = app.page
  assert.deepEqual(await templates(), created)
  await page.getByRole('button', { name: '新建记录', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择类型', exact: true })
  assert.deepEqual((await picker.getByRole('button').allTextContents()).map(text => text.trim()).filter(text => expected.includes(text)), expected)
  await page.keyboard.press('Escape')
  await picker.waitFor({ state: 'hidden' })

  await page.getByRole('link', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '云端配置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '云端配置', exact: true })
  const close = dialog.getByRole('button', { name: '关闭云端配置', exact: true })
  assert.equal(await dialog.locator('input[name=bucket]').getAttribute('placeholder'), 'omlr')
  assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).count(), 0)
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"][data-state="open"]')].every(element => element.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')))
  const rect = await close.boundingBox(), viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  assert.ok(rect.y >= 0 && rect.y < 32 && viewport.width - rect.x - rect.width < 32)
  await dialog.evaluate(element => { element.scrollTop = element.scrollHeight })
  assert.equal(Math.round((await close.boundingBox()).y), Math.round(rect.y))
  await dialog.locator('input[name=endpoint]').fill(cloud.endpoint)
  await dialog.locator('input[name=accessKeyId]').fill('test')
  await dialog.locator('input[name=accessKeySecret]').fill('test')
  await dialog.locator('input[name=bucket]').fill('bucket')
  await page.screenshot({ path: resolve('.scratch/android-native/verified-cloud-config.png') })
  release = cloud.pauseRequest('GET', '')
  await page.evaluate(() => {
    const original = Capacitor.nativePromise
    window.connectionCompleted = new Promise(resolve => { window.resolveConnection = resolve })
    window.restoreConnectionBridge = () => { Capacitor.nativePromise = original }
    Capacitor.nativePromise = async (plugin, method, options) => {
      const result = await original(plugin, method, options)
      if (plugin === 'LocalData' && method === 'network') window.resolveConnection()
      return result
    }
  })
  await dialog.getByRole('button', { name: '连接', exact: true }).click()
  for (let i = 0; cloud.requests.length === 0 && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(cloud.requests.length, 1)
  await close.click()
  await dialog.waitFor({ state: 'hidden' })
  release()
  await page.evaluate(async () => { await window.connectionCompleted; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); window.restoreConnectionBridge() })
  assert.equal((await native(page, 'readPreference', { key: 'cloud-credential' })).value, preferences['cloud-credential'])
})

test('Android 带图保存、取消、离线重启、手动备份、删除传播和中断恢复', { timeout: 150_000 }, async (t) => {
  // 通过真实 WebView 和原生插件操作：草稿取消不能落盘，保存后必须能离线重开。
  // 隔离 S3 服务控制上传和下载中断，恢复中途杀进程后继续，验证写入锁、只传缺图、先提交后删除，以及恢复前保留当前数据库。
  let app = await connectAndroid(); let page = app.page
  const removePhoto = await seedPhoto()
  const cloud = await s3Server(), directory = await mkdtemp(resolve(tmpdir(), 'omlr-native-'))
  const oldConfig = (await native(page, 'readPreference', { key: 'cloud-credential' })).value
  const config = { endpoint: cloud.endpoint, bucket: 'bucket', accessKeyId: 'test', accessKeySecret: 'test' }
  const stateKey = 'sync-state'
  const oldSyncState = (await native(page, 'readPreference', { key: stateKey })).value
  const name = 'Android 验收 ' + randomUUID(), remoteId = 'remote-' + randomUUID()
  let recordId, image, remoteImagePath
  const feedback = { heights: {} }
  let release = () => {}
  t.after(async () => {
    if (!page.isClosed()) {
      const ui = await page.evaluate(() => ({
        stages: [...document.querySelectorAll('[role="dialog"][data-state="open"] [role="status"]')].map(element => element.textContent),
        toasts: [...document.querySelectorAll('[data-scope="toast"][data-part="title"]')].map(element => element.textContent),
      })).catch(() => undefined)
      await writeFile(resolve('.scratch/android-native/sync-feedback-ui-debug.json'), JSON.stringify({ endpoint: cloud.endpoint, requests: cloud.requests, ui, feedback }, null, 2) + '\n')
    }
    release()
    if (!page.isClosed()) await page.waitForFunction(() => !document.querySelector('[aria-label="手动同步"]')?.disabled, undefined, { timeout: 10_000 }).catch(() => {})
    try {
      await native(page, 'preference', { key: 'cloud-credential', value: oldConfig })
      await native(page, 'preference', { key: stateKey, value: oldSyncState })
      await native(page, 'preference', { key: 'native-test-receipt', value: null })
      await native(page, 'execute', { statements: [{ sql: 'DELETE FROM records WHERE id IN (?,?)', values: [recordId ?? '', remoteId] }, { sql: 'DELETE FROM images WHERE NOT EXISTS(SELECT 1 FROM record_images WHERE image_id=images.id)' }, { sql: 'UPDATE meta SET change_seq=change_seq+1' }] })
      await native(page, 'removeFiles', { paths: [image?.path, remoteImagePath].filter(Boolean) })
    } finally { await app.close(); await cloud.close(); await removePhoto(); await rm(directory, { recursive: true, force: true }) }
  })
  const before = (await native(page, 'query', { sql: 'SELECT COUNT(*) AS count FROM images', values: [] })).rows[0].count
  await newRecord(page)
  // 原生选图结果尚未交付就关闭表单；迟到的草稿引用不能进入接下来的编辑会话。
  // 通过真实选图器得到结果后暂停 JS 交付，确认该阶段没有图片文件和数据库写入。
  await page.evaluate(() => {
    const original = Capacitor.nativePromise
    window.restoreImageBridge = () => { Capacitor.nativePromise = original }
    Capacitor.nativePromise = async (plugin, method, options) => {
      const result = await original(plugin, method, options)
      if (plugin === 'LocalData' && method === 'pickImages') {
        window.lateImageToken = result.images[0].token
        await new Promise(resolve => { window.releaseDraft = resolve })
      }
      return result
    }
  })
  await upload(page)
  await page.waitForFunction(() => typeof window.releaseDraft === 'function')
  assert.equal((await native(page, 'query', { sql: 'SELECT COUNT(*) AS count FROM images', values: [] })).rows[0].count, before)
  const imageFiles = adb('shell', 'run-as', 'app.ohmylife.record', 'find', 'files', 'cache', '-type', 'f')
    .split('\n').filter(path => /^(files\/images|cache\/(thumbnails|previews))\//.test(path))
  assert.deepEqual(imageFiles, [])
  adb('shell', 'input', 'keyevent', '4')
  await page.getByRole('heading', { name: '新建记录', exact: true }).waitFor({ state: 'hidden' })
  await page.evaluate(() => { window.restoreImageBridge(); window.releaseDraft() })
  await page.evaluate(() => {
    const original = Capacitor.nativePromise
    window.restoreImageBridge = () => { Capacitor.nativePromise = original }
    Capacitor.nativePromise = (plugin, method, options) => {
      if (plugin === 'LocalData' && method === 'writeImage') window.imageWriteOptions = options
      return original(plugin, method, options)
    }
  })
  await newRecord(page)
  // 被取消编辑会话的迟到引用已经释放，不能用于写入图片文件。
  await assert.rejects(native(page, 'writeImage', { id: 'cancelled-draft-check', token: await page.evaluate(() => window.lateImageToken) }), /已失效/)
  await page.locator('input[name=name]').fill(name); await upload(page)
  await page.getByRole('button', { name: '删除图片', exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('heading', { name: '新建记录', exact: true }).waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(() => Object.keys(window.imageWriteOptions).sort()), ['id', 'token'])
  await page.evaluate(() => window.restoreImageBridge())
  recordId = (await native(page, 'query', { sql: 'SELECT id FROM records WHERE name=?', values: [name] })).rows[0].id
  image = (await native(page, 'query', { sql: 'SELECT images.* FROM images JOIN record_images ON image_id=images.id WHERE record_id=?', values: [recordId] })).rows[0]
  assert.ok((await native(page, 'fileInfo', { path: image.path, verify: true })).file.sha256 === image.sha256)
  const dimensions = await page.evaluate(async path => {
    const result = await Capacitor.Plugins.LocalData.imageSource({ path, thumbnail: false })
    const image = new Image(); image.src = Capacitor.convertFileSrc(result.uri); await image.decode()
    return [image.naturalWidth, image.naturalHeight]
  }, image.path)
  assert.deepEqual(dimensions, [2048, 1536])
  await page.locator('img[alt="记录图片"]').first().waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('img[alt="记录图片"]')].every((image) => image.naturalWidth > 0))
  await native(page, 'preference', { key: 'cloud-credential', value: JSON.stringify(config) })
  await page.reload(); await page.getByRole('button', { name: '手动同步' }).waitFor()
  await page.evaluate(() => {
    window.syncStageTimings = []
    const observer = new MutationObserver(() => {
      const status = document.querySelector('[role="dialog"][data-state="open"] [role="status"]')
      const stage = status?.textContent.replace(/（.*$/, '')
      const current = window.syncStageTimings.at(-1)
      if (stage === current?.stage) return
      const now = performance.now()
      if (current) current.duration = now - current.started
      if (stage) window.syncStageTimings.push({ stage, started: now })
      else if (current) observer.disconnect()
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  })
  const releaseGate = cloud.pauseImages(), releaseCheck = cloud.pauseRequest('HEAD', 'data/database.sqlite')
  release = () => { releaseCheck(); releaseGate() }
  await page.getByRole('button', { name: '手动同步' }).click()
  const syncDialog = page.getByRole('dialog', { name: '正在同步', exact: true })
  await syncDialog.getByText('检查云端', { exact: true }).waitFor()
  // Loading 下方始终只有一行状态文字，不能有第二行传输量或额外占位。
  // 比较检查与上传两个被服务端暂停的真实阶段，避免快速切换掩盖布局跳动。
  assert.equal(await syncDialog.getByText('同步完成后可继续操作', { exact: true }).count(), 0)
  const checkingHeight = await syncDialog.evaluate((dialog) => dialog.offsetHeight)
  feedback.heights.checking = checkingHeight
  releaseCheck()
  await syncDialog.getByText(/^上传图片/).waitFor()
  assert.equal(await syncDialog.getByRole('progressbar').count(), 0)
  await syncDialog.getByText('上传图片（0/1）', { exact: true }).waitFor()
  feedback.layout = await syncDialog.evaluate((dialog) => {
    const status = dialog.querySelector('[role="status"]'), style = getComputedStyle(status)
    const content = getComputedStyle(dialog)
    return { statusHeight: status.getBoundingClientRect().height, lineHeight: parseFloat(style.lineHeight), whiteSpace: style.whiteSpace,
      textAfterStatus: status.nextElementSibling?.textContent.trim() ?? '', paddingTop: content.paddingTop, paddingBottom: content.paddingBottom }
  })
  assert.equal(feedback.layout.textAfterStatus, '', '状态下方不能出现第二行文字或占位')
  assert.equal(feedback.layout.whiteSpace, 'nowrap')
  assert.ok(Math.abs(feedback.layout.statusHeight - feedback.layout.lineHeight) <= 1, '状态区只占一行')
  assert.equal(feedback.layout.paddingTop, feedback.layout.paddingBottom, '窗口上下内边距一致')
  feedback.heights.uploading = await syncDialog.evaluate((dialog) => dialog.offsetHeight)
  assert.ok(Math.abs(feedback.heights.uploading - checkingHeight) <= 1)
  // 上传尚未完成时，进度必须位于覆盖整个应用的模态弹窗内。
  // Escape、遮罩点击和 Android 返回键都不能结束同步；背景导航也不能抢走交互。
  // 这样用户看到的阻塞状态与原生写入锁一致，避免点击无效操作或切换到其他编辑入口。
  await syncDialog.waitFor()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const positioner = await syncDialog.locator('..').boundingBox()
  // 高 DPI WebView 的窗口尺寸取整，覆盖边界允许 1 个 CSS 像素的舍入差异。
  assert.ok(positioner.x <= 1 && positioner.y <= 1 && positioner.width >= viewport.width - 1 && positioner.height >= viewport.height - 1)
  await page.keyboard.press('Escape')
  await page.mouse.click(1, 1)
  adb('shell', 'input', 'keyevent', '4')
  assert.equal(await syncDialog.isVisible(), true)
  // Android 返回键可暂时把焦点交还文档；继续按 Tab 时必须仍被限制在进度窗口内。
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => document.querySelector('[role="dialog"][data-state="open"]')?.contains(document.activeElement))
  await assert.rejects(page.getByRole('link', { name: '设置', exact: true, includeHidden: true }).click({ timeout: 300 }))
  await assert.rejects(native(page, 'execute', { statements: [] }), /同步期间/)
  await page.screenshot({ path: resolve('.scratch/android-native/verified-sync-feedback.png') })
  assert.match(adb('shell', 'dumpsys', 'window'), /KEEP_SCREEN_ON/)
  releaseGate(); release = () => {}
  await page.waitForFunction(() => !document.querySelector('[aria-label="手动同步"]').disabled)
  await syncDialog.waitFor({ state: 'hidden' })
  await page.getByText('云端已更新', { exact: true }).waitFor()
  // 在真实 WebView 中观察文字变化与弹窗关闭；所有出现的阶段都应留足阅读时间。
  // DOM 提交相对计时器有少量帧间误差，允许 40 毫秒，但不能出现一闪而过的步骤。
  feedback.stages = await page.evaluate(() => window.syncStageTimings)
  assert.ok(feedback.stages.length >= 4)
  for (const stage of feedback.stages) assert.ok(stage.duration >= 760, `${stage.stage} 只显示了 ${stage.duration} 毫秒`)
  assert.ok(cloud.objects.has('data/database.sqlite'))
  const imageBody = Buffer.from(cloud.objects.get('data/' + image.path).body)
  const puts = cloud.requests.filter((request) => request.method === 'PUT').length
  await synchronize(page)
  await page.getByText('已是最新', { exact: true }).waitFor()
  assert.equal(cloud.requests.filter((request) => request.method === 'PUT').length, puts)
  await page.getByRole('button').filter({ hasText: name }).press('Enter')
  await page.getByRole('heading', { name: '编辑记录', exact: true }).waitFor()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  const deletion = page.getByRole('dialog').filter({ hasText: '删除记录' })
  await deletion.getByRole('button', { name: '删除', exact: true }).click()
  await deletion.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '编辑记录', exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await native(page, 'fileInfo', { path: image.path })).file, undefined)
  await synchronize(page)
  await page.getByText('云端已更新', { exact: true }).waitFor()
  assert.equal(cloud.objects.has('data/' + image.path), false)
  const snapshot = resolve(directory, 'database.sqlite')
  await writeFile(snapshot, cloud.objects.get('data/database.sqlite').body)
  remoteImagePath = 'images/' + remoteId + '.webp'
  const database = new DatabaseSync(snapshot)
  try {
    database.prepare('INSERT INTO images VALUES(?,?,?,?,?)').run(remoteId, remoteImagePath, 'image/webp', imageBody.length, createHash('sha256').update(imageBody).digest('hex'))
    database.prepare('INSERT INTO records VALUES(?,?,?,?,?,?,?)').run(remoteId, Math.floor(Date.now() / 60000) * 60000 + 12345, '原生恢复', '原生恢复', '云端恢复验收', '', '{}')
    database.prepare('INSERT INTO record_images VALUES(?,?,?)').run(remoteId, remoteId, 0)
    database.exec('UPDATE meta SET change_seq=change_seq+1')
  } finally { database.close() }
  cloud.objects.set('data/' + remoteImagePath, { body: imageBody, headers: { 'content-type': 'image/webp' } })
  cloud.setSnapshot(await readFile(snapshot), 3)
  // 冲突确认必须能替换进度窗口，并允许在开始传输前取消。
  // 取消后应恢复页面交互；再次确认覆盖时，进度窗口必须继续展示恢复阶段。
  await native(page, 'execute', { statements: [{ sql: 'UPDATE meta SET change_seq=change_seq+1' }] })
  await closeToasts(page)
  await page.getByRole('button', { name: '手动同步' }).click()
  const conflictDialog = page.getByRole('dialog', { name: '发现云端冲突', exact: true })
  await conflictDialog.waitFor()
  assert.equal(await syncDialog.isVisible(), false)
  await conflictDialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="手动同步"]').disabled)
  await conflictDialog.waitFor({ state: 'hidden' })
  await native(page, 'execute', { statements: [] })
  // 取消冲突确认只关闭窗口并恢复交互，不产生结果 Toast。
  assert.equal(await page.locator('[data-scope="toast"][data-part="title"]').count(), 0)
  cloud.breakImage('data/' + remoteImagePath)
  await synchronize(page, true)
  // 网络失败必须撤下遮罩并恢复交互，同时保留明确的失败结果，不能把用户困在同步窗口中。
  await syncDialog.waitFor({ state: 'hidden' })
  await page.getByText(/^同步失败：/).waitFor()
  assert.equal((await native(page, 'query', { sql: 'SELECT id FROM records WHERE id=?', values: [remoteId] })).rows.length, 0)
  await native(page, 'execute', { statements: [] })
  const databaseGets = cloud.requests.filter((request) => request.method === 'GET' && request.key === 'data/database.sqlite').length
  cloud.breakImage(undefined)
  const resume = cloud.pauseRequest('GET', 'data/' + remoteImagePath)
  release = resume
  await closeToasts(page)
  await page.getByRole('button', { name: '手动同步' }).click()
  await conflictDialog.waitFor()
  await conflictDialog.getByRole('button', { name: '覆盖并同步', exact: true }).click()
  await syncDialog.getByText('恢复图片（0/1）', { exact: true }).waitFor()
  feedback.heights.restoring = await syncDialog.evaluate((dialog) => dialog.offsetHeight)
  assert.ok(Math.abs(feedback.heights.restoring - checkingHeight) <= 1)
  await app.close(); adb('shell', 'am', 'force-stop', 'app.ohmylife.record')
  resume(); release = () => {}
  app = await connectAndroid(); page = app.page
  await native(page, 'execute', { statements: [] })
  await synchronize(page, true)
  await page.getByText('本地已更新', { exact: true }).waitFor()
  assert.equal(cloud.requests.filter((request) => request.method === 'GET' && request.key === 'data/database.sqlite').length, databaseGets)
  await page.getByText('云端恢复验收', { exact: true }).waitFor()
  const time = (await native(page, 'query', { sql: 'SELECT time FROM records WHERE id=?', values: [remoteId] })).rows[0].time
  await page.getByRole('button').filter({ hasText: '云端恢复验收' }).press('Enter')
  await page.locator('textarea[name=description]').fill('确认毫秒保留')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('heading', { name: '编辑记录', exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await native(page, 'query', { sql: 'SELECT time FROM records WHERE id=?', values: [remoteId] })).rows[0].time, time)
  const requestCount = cloud.requests.length
  await app.close(); adb('shell', 'am', 'force-stop', 'app.ohmylife.record')
  // 模拟数据库替换已提交、偏好回执尚未写完的进程退出窗口；启动时必须完成回执。
  writeAndroidFile('files/restore-receipt.json', JSON.stringify({ path: 'transfers/' + randomUUID() + '/database.sqlite', key: 'native-test-receipt', value: 'installed' }))
  app = await connectAndroid(); page = app.page
  assert.equal((await native(page, 'readPreference', { key: 'native-test-receipt' })).value, 'installed')
  await page.getByText('云端恢复验收', { exact: true }).waitFor()
  assert.equal(cloud.requests.length, requestCount)
  await page.waitForFunction(() => [...document.querySelectorAll('img[alt="记录图片"]')].some((image) => image.naturalWidth > 0))
  await page.screenshot({ path: resolve('.scratch/android-native/verified-records.png') })

  // 用网络接口抛出的长单词错误走完整失败提示路径。提示必须留在视口内，
  // 文字可通过水平触摸滑动阅读，关闭按钮则始终留在固定位置且能正常关闭。
  const longError = '验收长错误：' + 'request_detail_'.repeat(100) + '结束标记'
  await page.evaluate((message) => {
    const original = Capacitor.nativePromise
    window.restoreToastNetwork = () => { Capacitor.nativePromise = original }
    Capacitor.nativePromise = (plugin, method, options) => plugin === 'LocalData' && method === 'network'
      ? Promise.reject(new Error(message)) : original(plugin, method, options)
  }, longError)
  try {
    await synchronize(page)
    const title = page.getByText('同步失败：' + longError, { exact: true })
    await title.waitFor()
    await title.hover()
    const bounds = await title.locator('..').boundingBox()
    const viewportWidth = await page.evaluate(() => innerWidth)
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewportWidth + 1, '长提示不能超出屏幕')
    assert.equal(await title.evaluate((element) => element.scrollWidth > element.clientWidth), true)
    const region = await title.boundingBox()
    const session = await page.context().newCDPSession(page)
    try {
      await session.send('Input.synthesizeScrollGesture', { x: region.x + region.width * 0.75, y: region.y + region.height / 2, xDistance: -region.width / 2, yDistance: 0, speed: 300, gestureSourceType: 'touch' })
    } finally { await session.detach() }
    await page.waitForFunction(() => document.querySelector('[data-scope="toast"][data-part="title"]').scrollLeft > 0)
    feedback.toast = await title.evaluate((element) => ({ width: element.clientWidth, contentWidth: element.scrollWidth, scrollLeft: element.scrollLeft }))
    const close = title.locator('..').getByRole('button', { name: '关闭提示' })
    const closeBounds = await close.boundingBox()
    assert.ok(closeBounds.x >= region.x + region.width - 1, '关闭按钮不能覆盖可滚动文字')
    await page.screenshot({ path: resolve('.scratch/android-native/verified-scrollable-toast.png') })
    await close.click()
    await title.waitFor({ state: 'hidden' })
  } finally {
    await page.evaluate(() => { window.restoreToastNetwork?.(); delete window.restoreToastNetwork })
  }
})

test('Android 草稿缩略图和大图通过原生内存流显示，取消不留下图片文件', { timeout: 40_000 }, async (t) => {
  // 真实系统选图结果经过 Capacitor 的 content URI 进入 WebView。直接检查两种预览
  // 的解码尺寸，避免仅测试原生流成功而漏掉 WebView 侧地址或 MIME 问题。
  // 预览前后图片目录必须相同，取消后引用必须失效，数据库也不能多出图片记录。
  const app = await connectAndroid(), page = app.page, removePhoto = await seedPhoto()
  t.after(async () => {
    await app.close()
    adb('shell', 'am', 'force-stop', 'app.ohmylife.record')
    await removePhoto()
  })
  await page.reload(); await page.getByRole('button', { name: '新建记录' }).waitFor()
  const files = () => adb('shell', 'run-as', 'app.ohmylife.record', 'find', 'files', 'cache', '-type', 'f')
    .split('\n').filter(path => /^(files\/images|cache\/(thumbnails|previews))\//.test(path)).sort()
  const beforeFiles = files(), before = (await native(page, 'query', { sql: 'SELECT COUNT(*) AS count FROM images', values: [] })).rows[0].count
  await newRecord(page); await upload(page)
  const thumbnail = page.getByRole('dialog', { name: '新建记录', exact: true }).locator('img[alt="记录图片"]')
  await thumbnail.waitFor()
  await thumbnail.evaluate(image => image.decode())
  assert.deepEqual(await thumbnail.evaluate(image => [image.naturalWidth, image.naturalHeight]), [320, 240])
  const token = /\.image-drafts\/([^/]+)/.exec(await thumbnail.getAttribute('src'))[1]
  await page.getByRole('button', { name: '查看记录图片', exact: true }).click()
  const preview = page.locator('img[alt="记录图片大图"]')
  await preview.waitFor(); await preview.evaluate(image => image.decode())
  assert.deepEqual(await preview.evaluate(image => [image.naturalWidth, image.naturalHeight]), [2048, 1536])
  assert.deepEqual(files(), beforeFiles)
  await page.screenshot({ path: resolve('.scratch/android-native/verified-native-draft-preview.png') })
  await page.getByRole('button', { name: '关闭图片预览' }).click()
  adb('shell', 'input', 'keyevent', '4')
  await page.getByRole('heading', { name: '新建记录', exact: true }).waitFor({ state: 'hidden' })
  await assert.rejects(native(page, 'writeImage', { id: 'cancelled-preview-check', token }), /已失效/)
  assert.deepEqual(files(), beforeFiles)
  assert.equal((await native(page, 'query', { sql: 'SELECT COUNT(*) AS count FROM images', values: [] })).rows[0].count, before)
})
