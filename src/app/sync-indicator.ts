/** 应用级连接及同步状态；后台只检查，业务读写只由手动同步触发。 */
import { currentCloud, storage } from './runtime'
import { checkForUpdates } from '../features/cloud/sync/engine'
import { CloudDataError, CloudRequestError, CloudTimeoutError } from '../features/cloud/request-error'
import type { SyncIndicator } from '../features/cloud/sync/engine.type'
import type { SyncIndicatorListener, SyncSnapshot } from './sync-indicator.type'

let snapshot: SyncSnapshot = { connection: 'offline', indicator: 'none' }
let checkInFlight: Promise<SyncIndicator | undefined> | undefined
let generation = 0
let localGeneration = 0
let localRead = 0
let monitorCleanup: (() => void) | undefined
const listeners = new Set<SyncIndicatorListener>()

function publish(next: SyncSnapshot) {
  if (snapshot.connection === next.connection && snapshot.indicator === next.indicator &&
    snapshot.checkError === next.checkError) return
  snapshot = next
  for (const listener of listeners) listener()
}

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot
}

export function subscribeSyncIndicator(listener: SyncIndicatorListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 忽略旧凭证、后台挂起前及同步开始前的只读结果。 */
export function cancelSyncCheck(): void {
  generation++
  checkInFlight = undefined
  if (snapshot.connection === 'connecting') publish({ ...snapshot, connection: 'offline' })
}

export function resetSyncIndicator(): void {
  cancelSyncCheck()
  publish({ connection: 'offline', indicator: snapshot.indicator })
}

async function readLocalDirty(): Promise<boolean> {
  const [states, templates] = await Promise.all([
    storage.getAllPartitionStates(), storage.getTypeTemplateState(),
  ])
  return states.some((state) => state.dirty) || Boolean(templates?.dirty)
}

function withLocalDirty(indicator: SyncIndicator, upload: boolean): SyncIndicator {
  const download = indicator === 'download' || indicator === 'both'
  return download ? (upload ? 'both' : 'download') : (upload ? 'upload' : 'none')
}

/** 本地写入后立即更新待上传提示；不等待、不发起任何网络请求。 */
export async function refreshLocalSyncIndicator(): Promise<void> {
  localGeneration++
  const read = ++localRead
  const upload = await readLocalDirty()
  if (read === localRead) publish({ ...snapshot, indicator: withLocalDirty(snapshot.indicator, upload) })
}

export function reportSyncFailure(error: unknown): void {
  cancelSyncCheck()
  publish({
    connection: error instanceof CloudDataError ? 'connected' : 'offline',
    indicator: snapshot.indicator,
    checkError: error,
  })
}

/** 手动与自动共用一次检查；离线时显示连接中，已连接时保持现有同步文案。 */
export function refreshSyncIndicator(): Promise<SyncIndicator | undefined> {
  const cloud = currentCloud()
  if (!cloud) {
    resetSyncIndicator()
    return Promise.resolve(undefined)
  }
  if (checkInFlight) return checkInFlight
  const requestGeneration = generation
  const dirtyGeneration = localGeneration
  const isCurrent = () => requestGeneration === generation && cloud === currentCloud()
  if (snapshot.connection !== 'connected') publish({ ...snapshot, connection: 'connecting' })

  const request = checkForUpdates(storage, cloud)
    .then(async (next) => {
      if (dirtyGeneration !== localGeneration) next = withLocalDirty(next, await readLocalDirty())
      if (!isCurrent()) return undefined
      publish({ connection: 'connected', indicator: next })
      return next
    })
    .catch((error: unknown) => {
      if (!isCurrent()) return undefined
      publish({
        connection: error instanceof CloudDataError ? 'connected' : 'offline',
        indicator: snapshot.indicator,
        checkError: error,
      })
      throw error
    })
    .finally(() => {
      if (checkInFlight === request) checkInFlight = undefined
    })
  checkInFlight = request
  return request
}

function temporaryError(error: unknown): boolean {
  return error instanceof TypeError || error instanceof CloudTimeoutError ||
    (error instanceof CloudRequestError &&
      (error.status === 408 || error.status === 429 || error.status >= 500))
}

/** 前台每 60 秒检查，恢复/网络事件合并 1.5 秒；所有自动失败静默。 */
export function startSyncIndicatorMonitor(isSyncBusy: () => boolean = () => false): () => void {
  if (monitorCleanup) return monitorCleanup
  if (!currentCloud()) return () => {}
  let active = true
  let visibilityGeneration = 0
  let pendingTimer: number | undefined

  const cancelPending = () => {
    if (pendingTimer !== undefined) window.clearTimeout(pendingTimer)
    pendingTimer = undefined
  }
  const schedule = (retry = false) => {
    if (!active || document.visibilityState !== 'visible' || pendingTimer !== undefined) return
    pendingTimer = window.setTimeout(() => {
      pendingTimer = undefined
      void refresh(retry)
    }, 1500)
  }
  const resume = () => schedule()
  const refresh = async (retry = false) => {
    if (!active || document.visibilityState !== 'visible' || isSyncBusy() ||
      pendingTimer !== undefined || !currentCloud()) return
    const requestGeneration = visibilityGeneration
    try {
      await refreshSyncIndicator()
    } catch (error) {
      if (active && requestGeneration === visibilityGeneration &&
        document.visibilityState === 'visible' && !retry && temporaryError(error)) schedule(true)
      // 不提示、不打开连接面板；下一周期仍可重连。
    }
  }
  const visibility = () => {
    visibilityGeneration++
    if (document.visibilityState === 'visible') {
      resume()
    } else {
      cancelPending()
      cancelSyncCheck()
    }
  }
  const timer = window.setInterval(() => { void refresh() }, 60_000)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('online', resume)
  window.addEventListener('offline', resume)
  void refresh()

  const cleanup = () => {
    active = false
    cancelPending()
    cancelSyncCheck()
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('online', resume)
    window.removeEventListener('offline', resume)
    if (monitorCleanup === cleanup) monitorCleanup = undefined
  }
  monitorCleanup = cleanup
  return cleanup
}
