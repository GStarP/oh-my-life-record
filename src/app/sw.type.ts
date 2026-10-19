/// <reference lib="webworker" />
import type { PrecacheEntry } from 'workbox-precaching'

/** 构建插件将清单注入 worker；类型与页面的 Window 全局分开。 */
export type AppShellWorker = ServiceWorkerGlobalScope & {
  __WB_MANIFEST: PrecacheEntry[]
}
