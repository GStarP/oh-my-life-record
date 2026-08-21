/**
 * 应用级同步状态缓存。
 *
 * 同步状态属于应用，而不是记录页：页面是否可见不影响状态和后台检查器，
 * 重新进入记录页时可以直接拿到最近一次结果。
 */
import { currentCloud, storage } from './runtime'
import { checkForUpdates } from '../features/cloud/sync/engine'
import type { SyncIndicator } from '../features/cloud/sync/engine.type'
import type { SyncIndicatorListener } from './sync-indicator.type'

let indicator: SyncIndicator = 'none'
let checkInFlight: Promise<SyncIndicator | undefined> | undefined
let monitorCleanup: (() => void) | undefined
const listeners = new Set<SyncIndicatorListener>()

function publish(next: SyncIndicator) {
  if (indicator === next) return
  indicator = next
  for (const listener of listeners) listener()
}

export function getSyncIndicator(): SyncIndicator {
  return indicator
}

export function subscribeSyncIndicator(listener: SyncIndicatorListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 主动检查一次；多个调用会共享同一个进行中的检查。 */
export function refreshSyncIndicator(): Promise<SyncIndicator | undefined> {
  const cloud = currentCloud()
  if (!cloud) {
    publish('none')
    return Promise.resolve(undefined)
  }
  if (checkInFlight) return checkInFlight

  checkInFlight = checkForUpdates(storage, cloud)
    .then((next) => {
      publish(next)
      return next
    })
    .finally(() => {
      checkInFlight = undefined
    })

  return checkInFlight
}

/**
 * 启动应用生命周期内的后台只读检查。
 * 返回的清理函数只在根布局卸载时调用，页面路由切换不会影响它。
 */
export function startSyncIndicatorMonitor(
  onError: (error: unknown) => void,
): () => void {
  if (monitorCleanup) return monitorCleanup

  const refresh = () => {
    if (!window.navigator.onLine) return
    void refreshSyncIndicator().catch(onError)
  }
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') refresh()
  }
  const handleOnline = () => refresh()
  const timer = window.setInterval(refresh, 60_000)

  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('online', handleOnline)
  refresh()

  const cleanup = () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('online', handleOnline)
    if (monitorCleanup === cleanup) monitorCleanup = undefined
  }
  monitorCleanup = cleanup
  return cleanup
}
