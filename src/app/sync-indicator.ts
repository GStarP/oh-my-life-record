/** 应用级同步指示器与前台只读检查；路由切换保留最近一次结果。 */
import { currentCloud, storage } from './runtime'
import { checkForUpdates } from '../features/cloud/sync/engine'
import { CloudRequestError } from '../features/cloud/request-error'
import type { SyncIndicator } from '../features/cloud/sync/engine.type'
import type { SyncIndicatorListener } from './sync-indicator.type'

let indicator: SyncIndicator = 'none'
let checkInFlight: Promise<SyncIndicator | undefined> | undefined
let monitorCleanup: (() => void) | undefined
const listeners = new Set<SyncIndicatorListener>()
const RESUME_DELAY_MS = 1500
const RETRY_DELAY_MS = 1500

function isTemporaryConnectionError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof CloudRequestError &&
      (error.status === 408 || error.status === 429 || error.status >= 500))
  )
}

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
 * 根布局在阻断或卸载时停止检查，重新验证配置后启动；路由切换不影响它。
 */
export function startSyncIndicatorMonitor(
  onError: (error: unknown) => void,
): () => void {
  if (monitorCleanup) return monitorCleanup

  let active = true
  let checking = false
  let generation = 0
  let pendingTimer: number | undefined

  const cancelPending = () => {
    if (pendingTimer !== undefined) window.clearTimeout(pendingTimer)
    pendingTimer = undefined
  }
  const scheduleRefresh = (delay: number, retry = false) => {
    if (!active || document.visibilityState !== 'visible' ||
      pendingTimer !== undefined) return
    pendingTimer = window.setTimeout(() => {
      pendingTimer = undefined
      void refresh(retry)
    }, delay)
  }
  const scheduleResume = () => scheduleRefresh(RESUME_DELAY_MS)
  const refresh = async (retry = false) => {
    if (!active || document.visibilityState !== 'visible' || checking ||
      pendingTimer !== undefined) return
    const requestGeneration = generation
    checking = true
    try {
      if (!window.navigator.onLine) throw new TypeError('当前网络不可用')
      await refreshSyncIndicator()
    } catch (error) {
      // 后台挂起或已停止的检查不能在恢复后触发旧的阻断结果。
      if (!active || requestGeneration !== generation ||
        document.visibilityState !== 'visible') return
      if (!retry && isTemporaryConnectionError(error)) {
        scheduleRefresh(RETRY_DELAY_MS, true)
      } else {
        onError(error)
      }
    } finally {
      checking = false
      if (active && requestGeneration !== generation) scheduleResume()
    }
  }
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      scheduleResume()
    } else {
      generation++
      cancelPending()
    }
  }
  const timer = window.setInterval(() => { void refresh() }, 60_000)

  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('online', scheduleResume)
  window.addEventListener('offline', scheduleResume)
  void refresh()

  const cleanup = () => {
    active = false
    generation++
    cancelPending()
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('online', scheduleResume)
    window.removeEventListener('offline', scheduleResume)
    if (monitorCleanup === cleanup) monitorCleanup = undefined
  }
  monitorCleanup = cleanup
  return cleanup
}
