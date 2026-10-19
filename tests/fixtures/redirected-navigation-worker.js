// 复现缓存重定向 HTML 导致导航失败的旧 worker，用于验证存量客户端升级。
// 故意直接返回带重定向历史的缓存 HTML；不要随生产修复一起更新此分支。
const APP_SHELL_CACHE = 'omlr-app-shell-before-navigation-fix'
const PRECACHE_ASSETS = /* __PRECACHE_ASSETS__ */ []

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(
    PRECACHE_ASSETS.map(({ url, integrity }) => new Request(new URL(url, self.location.origin), {
      integrity,
      cache: 'reload',
    })),
  )))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).origin !== self.location.origin) return
  event.respondWith(caches.open(APP_SHELL_CACHE).then(async (cache) =>
    await cache.match(event.request.mode === 'navigate' ? '/index.html' : event.request)
      ?? fetch(event.request),
  ))
})
