import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  TEST_CSP, createPwaEnvironment, ready, storageSnapshot, shellSnapshot,
  installUpdate, updateWorker, closeAndActivate,
} from './helpers/pwa-browser.mjs'

let environment
before(async () => { environment = await createPwaEnvironment() })
after(async () => { await environment?.close() })

test('同源 307 预缓存后连续刷新、深层导航和首次离线加载懒页面均正常', { timeout: 30_000 }, async (t) => {
  // 规范入口为 /，额外模拟它被托管层再次重定向：即使公开 URL 改变，Workbox 也应在
  // 写缓存时移除重定向历史。真实浏览器验证接管后导航、未访问页面的离线脚本以及 CSP，
  // 防止再次出现“首次可用、接管后 ERR_FAILED”，也不依赖 /index.html 必须直接返回文件。
  const { context, origin, redirects } = await environment.fixture(t, { redirectShell: true })
  const page = await context.newPage()
  await page.goto(origin + '/records')
  await ready(page)
  assert.ok(redirects() > 0)
  const cached = await shellSnapshot(page)
  assert.equal(cached.roots.length, 1)
  assert.equal(cached.roots[0].redirected, false, '重定向历史应在进入预缓存前消除')
  assert.equal(cached.paths.includes('/index.html'), false, '入口应使用规范公开 URL /')
  for (let i = 0; i < 3; i++) {
    const response = await page.reload()
    assert.equal(response.status(), 200)
    assert.equal(response.fromServiceWorker(), true)
    assert.match(response.headers()['content-type'], /text\/html/)
    assert.equal(response.headers()['content-security-policy'], TEST_CSP)
    await ready(page)
  }
  await context.setOffline(true)
  for (const path of ['/settings', '/settings/type-templates', '/records', '/']) {
    const response = await page.goto(origin + path)
    assert.equal(response.fromServiceWorker(), true)
    await ready(page)
    assert.equal((await page.reload()).status(), 200)
    await ready(page)
  }
})

test('坏 worker 更新等待旧页面关闭，激活修复后保留本地业务数据与图片缓存', { timeout: 30_000 }, async (t) => {
  // 从已复现故障的版本升级，防止只测干净安装漏掉存量用户。旧页面保留未保存输入，
  // 完整性失败时不能替换旧版本；成功更新也必须保持 waiting，关闭旧客户端后才允许激活。
  // 恢复后完整存储快照应一致：未同步记录、模板、同步状态、待上传图片、配置草稿、偏好及图片缓存。
  const { context, origin, useVersion, corruptNextHtml } = await environment.fixture(t, { version: 'legacy' })
  const page = await context.newPage()
  await page.goto(origin + '/records')
  await ready(page)
  const before = await storageSnapshot(page, true)
  await page.evaluate(() => {
    const draft = document.createElement('textarea')
    draft.id = 'unsaved-draft'
    draft.value = '未保存输入'
    document.body.append(draft)
  })
  const failingPage = await context.newPage()
  await assert.rejects(failingPage.goto(origin + '/settings'), /net::ERR_FAILED/)
  await failingPage.close()
  useVersion('current')
  corruptNextHtml()
  assert.equal(await updateWorker(page), 'redundant', 'HTML 完整性失败必须拒绝安装')
  assert.deepEqual(await storageSnapshot(page), before)
  assert.equal(await page.evaluate(async () => (await caches.keys()).includes('omlr-app-shell-before-navigation-fix')), true)
  const updatedWorker = await installUpdate(page, context)
  assert.equal(await page.locator('#unsaved-draft').inputValue(), '未保存输入')
  assert.equal(await page.evaluate(async () => (await caches.keys()).includes('omlr-app-shell-before-navigation-fix')), true)
  assert.deepEqual(await storageSnapshot(page), before)
  await closeAndActivate(page, updatedWorker)
  const recovered = await context.newPage()
  await recovered.goto(origin + '/records')
  await ready(recovered)
  for (let i = 0; i < 3; i++) {
    const response = await recovered.reload()
    assert.equal(response.fromServiceWorker(), true)
    await ready(recovered)
  }
  assert.deepEqual(await storageSnapshot(recovered), before)
  assert.equal(await recovered.evaluate(async () => (await caches.keys()).includes('omlr-app-shell-before-navigation-fix')), false)
  await context.setOffline(true)
  assert.equal((await recovered.reload()).status(), 200)
  await ready(recovered)
})

test('缓存访问抛错时在线回退；缺失时中止挂起请求，恢复后不回填旧内容', { timeout: 30_000 }, async (t) => {
  // 通过真实 worker 的 Cache Storage 与 fetch 接口注入故障，验证缓存访问失败不会阻断在线导航。
  // 缺失后的回退要真正发送 AbortSignal；仅将宿主时钟的 10 秒等待加速，仍核对请求时限为 10000ms。
  // 最后恢复网络检查可重试，且线上不同内容不会进入旧版本的预缓存。
  const { context, origin, useHtmlSuffix } = await environment.fixture(t)
  const page = await context.newPage()
  await page.goto(origin + '/records')
  await ready(page)
  const activeWorker = context.serviceWorkers()[0]
  const cached = await shellSnapshot(page)
  useHtmlSuffix('<!-- 在线回退内容 -->')
  await activeWorker.evaluate(() => {
    self.__pwaTest = { match: caches.match.bind(caches) }
    caches.match = async () => { throw new Error('测试缓存访问失败') }
  })
  const response = await page.reload()
  assert.match(await response.text(), /在线回退内容/)
  await ready(page)
  await activeWorker.evaluate(() => { caches.match = self.__pwaTest.match })
  assert.deepEqual(await shellSnapshot(page), cached)
  await page.evaluate(async () => {
    for (const name of await caches.keys()) if (name.startsWith('omlr-app-shell-')) await caches.delete(name)
  })
  await activeWorker.evaluate(() => {
    self.__pwaTest.fetch = self.fetch.bind(self)
    self.__pwaTest.setTimeout = self.setTimeout.bind(self)
    self.setTimeout = (callback, delay, ...args) => {
      if (delay === 10_000) self.__pwaTest.timeout = delay
      return self.__pwaTest.setTimeout(callback, delay === 10_000 ? 1 : delay, ...args)
    }
    self.fetch = (_request, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        self.__pwaTest.aborted = true
        reject(new Error('测试请求已中止'))
      })
    })
  })
  assert.equal(await page.evaluate(async () => {
    try { await fetch('/'); return false } catch { return true }
  }), true)
  assert.deepEqual(await activeWorker.evaluate(() => ({ timeout: self.__pwaTest.timeout, aborted: self.__pwaTest.aborted })), { timeout: 10_000, aborted: true })
  await activeWorker.evaluate(() => {
    self.fetch = self.__pwaTest.fetch
    self.setTimeout = self.__pwaTest.setTimeout
    delete self.__pwaTest
  })
  assert.match(await page.evaluate(async () => (await fetch('/')).text()), /在线回退内容/)
  assert.deepEqual((await shellSnapshot(page)).roots, [])
})

test('Workbox 更新保留旧页面版本，激活后清理旧条目且不影响业务数据', { timeout: 30_000 }, async (t) => {
  // Workbox 以资源版本区分同一 URL：新版安装时可以与旧版共存，不能提前清掉旧 HTML。
  // 使用真正的第二次生产构建而非修改内部变量，确认 waiting 期间刷新仍取旧版，
  // 旧客户端退出后才交付新版 HTML 并清理旧条目，未同步数据与图片缓存均完整。
  const { context, origin, useVersion, corruptNextHtml } = await environment.fixture(t)
  const page = await context.newPage()
  await page.goto(origin + '/records')
  await ready(page)
  const before = await storageSnapshot(page, true)
  const cached = await shellSnapshot(page)
  useVersion('next')
  corruptNextHtml()
  assert.equal(await updateWorker(page), 'redundant')
  assert.deepEqual(await shellSnapshot(page), cached, '安装失败不能删除或覆盖仍在使用的旧条目')
  const updatedWorker = await installUpdate(page, context)
  const versions = await shellSnapshot(page)
  assert.equal(versions.roots.length, 2, 'waiting 期间应同时保留新旧 HTML')
  assert.doesNotMatch(await (await page.reload()).text(), /下一版应用壳/)
  await ready(page)
  await closeAndActivate(page, updatedWorker)
  const recovered = await context.newPage()
  assert.match(await (await recovered.goto(origin + '/records')).text(), /下一版应用壳/)
  await ready(recovered)
  assert.equal((await shellSnapshot(recovered)).roots.length, 1)
  assert.deepEqual(await storageSnapshot(recovered), before)
})

test('Cloudflare 预览环境接管后刷新与离线导航正常', {
  timeout: 30_000, skip: !process.env.PWA_PREVIEW_ORIGIN,
}, async (t) => {
  // 本地模拟覆盖故障注入，预览验证则跨过实际托管路由。使用独立浏览器上下文，
  // 只读取页面并安装应用壳，不配置云端或写业务数据；确认 /index.html 的规范化、
  // 接管后连续刷新及未访问页面离线可用，防止构建成功掩盖部署平台差异。
  const origin = process.env.PWA_PREVIEW_ORIGIN.replace(/\/$/, '')
  const context = await environment.browser.newContext()
  t.after(() => context.close())
  const redirected = await context.request.get(origin + '/index.html', { maxRedirects: 0 })
  assert.equal(redirected.status(), 307)
  assert.equal(redirected.headers().location, '/')
  assert.equal((await context.request.get(origin + '/')).status(), 200)
  const page = await context.newPage()
  await page.goto(origin + '/records')
  await ready(page)
  for (let i = 0; i < 3; i++) {
    const response = await page.reload()
    assert.equal(response.status(), 200)
    assert.equal(response.fromServiceWorker(), true)
    await ready(page)
  }
  await context.setOffline(true)
  for (const path of ['/settings', '/settings/type-templates', '/records']) {
    assert.equal((await page.goto(origin + path)).fromServiceWorker(), true)
    await ready(page)
  }
})
