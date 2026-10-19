import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, relative, sep } from 'node:path'
import { build } from 'vite'
import { chromium } from 'playwright'

export const TEST_CSP = "base-uri 'self'; object-src 'none'"

async function readBuild(directory) {
  const files = new Map()
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const path = resolve(entry.parentPath, entry.name)
    files.set('/' + relative(directory, path).split(sep).join('/'), await readFile(path))
  }
  return files
}

/** 构建新旧应用壳并启动独立 Chromium；各用例只选择版本和注入故障。 */
export async function createPwaEnvironment() {
  const outDir = await mkdtemp(resolve(tmpdir(), 'omlr-pwa-browser-'))
  let browser
  const close = async () => {
    try { await browser?.close() }
    finally { await rm(outDir, { recursive: true, force: true }) }
  }
  try {
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    const current = await readBuild(outDir)
    // 旧清单使用磁盘 URL，从构建文件生成，避免依赖编译后 worker 的内部变量。
    const manifest = [...current].filter(([url]) => url !== '/sw.js').map(([url, body]) => ({
      url, integrity: 'sha256-' + createHash('sha256').update(body).digest('base64'),
    }))
    const legacyWorker = (await readFile(new URL('../fixtures/redirected-navigation-worker.js', import.meta.url), 'utf8'))
      .replace('/* __PRECACHE_ASSETS__ */ []', JSON.stringify(manifest))
    const nextDir = resolve(outDir, 'next')
    await build({
      logLevel: 'silent', build: { outDir: nextDir, emptyOutDir: true },
      plugins: [{ name: 'pwa-test-next-version', transformIndexHtml: (html) => html + '<!-- 下一版应用壳 -->' }],
    })
    const versions = {
      current,
      legacy: new Map(current).set('/sw.js', Buffer.from(legacyWorker)),
      next: await readBuild(nextDir),
    }
    browser = await chromium.launch({ channel: process.env.PWA_BROWSER_CHANNEL || undefined })
    console.log(`真实浏览器：${process.platform}，Chromium ${browser.version()}`)
    return { browser, fixture: (t, options) => fixture(t, browser, versions, options), close }
  } catch (error) {
    await close()
    throw error
  }
}

/** 同源静态服务器模拟 Cloudflare 的 HTML 规范化；不使用真实站点或云端数据。 */
async function fixture(t, browser, versions, { version = 'current', redirectShell = false } = {}) {
  let servedFiles = versions[version]
  let redirects = 0
  let corruptHtml = false
  let htmlSuffix = ''
  const mime = { js: 'text/javascript', html: 'text/html', css: 'text/css', png: 'image/png', webmanifest: 'application/manifest+json' }
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    if (path === '/index.html' || (redirectShell && path === '/')) {
      redirects++
      response.writeHead(307, { Location: path === '/index.html' ? '/' : '/shell/', 'Cache-Control': 'no-store' }).end()
      return
    }
    const key = servedFiles.has(path) ? path : '/index.html'
    response.writeHead(200, {
      'Content-Type': mime[key.split('.').pop()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': TEST_CSP,
    })
    let body = servedFiles.get(key)
    if (key === '/index.html' && htmlSuffix) body = Buffer.concat([body, Buffer.from(htmlSuffix)])
    if ((path === '/' || path === '/shell/') && corruptHtml) {
      corruptHtml = false
      body = Buffer.concat([body, Buffer.from('<!-- 部署切换期间的错误内容 -->')])
    }
    response.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const context = await browser.newContext()
  t.after(async () => {
    await context.close()
    await new Promise((resolve) => server.close(resolve))
  })
  return {
    context,
    origin: `http://127.0.0.1:${server.address().port}`,
    useVersion: (version) => { servedFiles = versions[version] },
    useHtmlSuffix: (suffix) => { htmlSuffix = suffix },
    corruptNextHtml: () => { corruptHtml = true },
    redirects: () => redirects,
  }
}

export async function ready(page) {
  const path = new URL(page.url()).pathname
  const label = path === '/settings' ? '云端配置'
    : path === '/settings/type-templates' ? '类型模板' : '已离线'
  await page.getByText(label, { exact: true }).waitFor({ timeout: 10_000 })
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated')
}

/** 读取真实业务存储；只在本用例独立浏览器上下文中写入合成数据。 */
export async function storageSnapshot(page, seed = false) {
  return page.evaluate(async (seed) => {
    const result = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const db = await result(indexedDB.open('omlr'))
    const stores = Array.from(db.objectStoreNames)
    if (seed) {
      const tx = db.transaction(stores, 'readwrite')
      tx.objectStore('records').put({
        id: '01J00000000000000000000000', time: new Date('2026-10-01T00:00:00Z'),
        type: '离线回归', name: '未同步记录', description: '升级前后必须保留',
        images: ['pending-image'], attributes: { 次数: 1 },
      })
      tx.objectStore('images').put({ blob: new Blob(['pending-image']), createdAt: 1 }, 'pending-image')
      tx.objectStore('partitionState').put({ month: '2026-10', remoteRevision: 7, dirty: true })
      tx.objectStore('typeTemplates').put({ type: '离线回归', icon: 'coffee', attributes: [] })
      tx.objectStore('typeTemplateState').put({ id: 'global', remoteRevision: 3, dirty: true })
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve
        tx.onabort = tx.onerror = () => reject(tx.error)
      })
      localStorage.setItem('omlr-color-mode', 'dark')
      localStorage.setItem('omlr-cloud-credential-draft', JSON.stringify({ endpoint: 'https://example.invalid', bucket: '' }))
      await (await caches.open('omlr-images-v1')).put('/uploaded-image', new Response('uploaded-image'))
    }
    const tx = db.transaction(stores)
    const entries = await Promise.all(stores.map(async (name) => [name, await result(tx.objectStore(name).getAll())]))
    for (const [, rows] of entries) {
      for (const row of rows) {
        if (row.blob instanceof Blob) row.blob = await row.blob.text()
      }
    }
    db.close()
    const image = await (await caches.open('omlr-images-v1')).match('/uploaded-image')
    return {
      entries,
      preferences: Object.entries(localStorage).sort(),
      uploadedImage: await image?.text(),
    }
  }, seed)
}

/** 通过公开 Cache Storage 接口检查实际缓存，不解析 Workbox 编译后的私有变量。 */
export async function shellSnapshot(page) {
  return page.evaluate(async () => {
    const name = (await caches.keys()).find((name) => name.startsWith('omlr-app-shell-workbox-'))
    if (!name) return { roots: [], paths: [] }
    const cache = await caches.open(name)
    const keys = await cache.keys()
    const roots = []
    for (const key of keys.filter((key) => new URL(key.url).pathname === '/')) {
      const response = await cache.match(key)
      roots.push({ redirected: response.redirected, body: await response.text() })
    }
    return { roots, paths: keys.map((key) => new URL(key.url).pathname) }
  })
}

export async function installUpdate(page, context) {
  const updated = context.waitForEvent('serviceworker')
  assert.equal(await updateWorker(page), 'installed')
  return updated
}

export async function updateWorker(page) {
  // update() 返回不代表安装完成；监听新 worker 的终态，区分安装成功与完整性失败。
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    let timer
    try {
      const installation = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('更新未结束安装')), 10_000)
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          const changed = () => {
            if (installing.state !== 'installed' && installing.state !== 'redundant') return
            installing.removeEventListener('statechange', changed)
            resolve(installing.state)
          }
          installing.addEventListener('statechange', changed)
          changed()
        }, { once: true })
      })
      await registration.update()
      return await installation
    } finally {
      clearTimeout(timer)
    }
  })
}

export async function closeAndActivate(page, updatedWorker) {
  const activated = updatedWorker.evaluate(() => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(timer); reject(new Error('更新未激活')) }, 10_000)
    const timer = setInterval(() => {
      if (self.serviceWorker.state !== 'activated') return
      clearInterval(timer)
      clearTimeout(timeout)
      resolve()
    }, 20)
  }))
  await page.close()
  await activated
}
