const APP_SHELL_CACHE = 'omlr-app-shell-v1'
const APP_SHELL_PREFIX = 'omlr-app-shell-'
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/omlr-icon-192.png',
  '/icons/omlr-icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith(APP_SHELL_PREFIX) && name !== APP_SHELL_CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseCopy = response.clone()
          void caches.open(APP_SHELL_CACHE).then((cache) => cache.put('/index.html', responseCopy))
          return response
        })
        .catch(() => caches.match('/index.html').then((response) => response ?? Response.error())),
    )
    return
  }

  const isAppShellAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
  if (!isAppShellAsset) return

  const updateCache = fetch(request).then((response) => {
    if (response.ok) {
      const responseCopy = response.clone()
      void caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, responseCopy))
    }
    return response
  })

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        event.waitUntil(updateCache.catch(() => undefined))
        return cached
      }
      return updateCache.catch(() => caches.match(request).then((response) => response ?? Response.error()))
    }),
  )
})
