/** 应用壳的预缓存、导航与升级；业务数据和图片缓存由各自 feature 管理。 */
import { PrecacheController, PrecacheRoute } from 'workbox-precaching'
import { Route, registerRoute, setCatchHandler } from 'workbox-routing'
import type { AppShellWorker } from './sw.type'

declare const self: AppShellWorker

// 名称只标识缓存格式；同一格式下由 Workbox 管理各资源版本与激活后的旧条目清理。
const APP_SHELL_CACHE = 'omlr-app-shell-workbox-v1'
const precache = new PrecacheController({ cacheName: APP_SHELL_CACHE, fallbackToNetwork: false })
precache.precache(self.__WB_MANIFEST)

registerRoute(new Route(
  ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
  precache.createHandlerBoundToURL('/'),
))
registerRoute(new PrecacheRoute(precache))

// 缓存缺失或不可读时仍允许在线访问；网络结果不写入当前版本的预缓存。
setCatchHandler(async ({ request }) => {
  console.warn('PWA 离线资源不可用，尝试网络')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    return await fetch(request, { signal: controller.signal })
  } catch {
    return Response.error()
  } finally {
    clearTimeout(timer)
  }
})

self.addEventListener('activate', (event) => {
  // 新 worker 完整安装且旧客户端退出后，才移除旧手写格式；图片缓存不在清理范围。
  event.waitUntil(caches.keys().then((names) => Promise.all(
    names.filter((name) => name.startsWith('omlr-app-shell-') && name !== APP_SHELL_CACHE)
      .map((name) => caches.delete(name)),
  )).then(() => self.clients.claim()))
})
