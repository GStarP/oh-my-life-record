// 构建时注入同一版本的全部资源；不手工维护带 hash 的懒加载脚本名。
const APP_SHELL_CACHE = 'omlr-app-shell-__BUILD_VERSION__'
const APP_SHELL_PREFIX = 'omlr-app-shell-'
const PRECACHE_ASSETS = /* __PRECACHE_ASSETS__ */ []
const PRECACHE_URLS = PRECACHE_ASSETS.map((asset) => asset.url)

self.addEventListener('install', (event) => {
  // addAll 全部成功才安装。更新保持 waiting，等旧页面退出再切换版本。
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(
    PRECACHE_ASSETS.map(({ url, integrity }) => new Request(new URL(url, self.location.origin), {
      integrity,
      cache: 'reload',
    })),
  )))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name.startsWith(APP_SHELL_PREFIX) && name !== APP_SHELL_CACHE)
        .map((name) => caches.delete(name)),
    )).then(() => self.clients.claim()),
  )
})

async function cachedResponse(request) {
  const cache = await caches.open(APP_SHELL_CACHE)
  const cached = await cache.match(request.mode === 'navigate' ? '/index.html' : request)
  if (cached) return cached

  // 缓存被系统淘汰时尽力在线恢复；不把新 HTML 写进旧版本缓存。
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    return await fetch(request, { signal: controller.signal })
  } catch {
    return Response.error()
  } finally {
    clearTimeout(timer)
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate' || PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(cachedResponse(request))
  }
})
