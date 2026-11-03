import { withDeadline } from '../utils/deadline'
import { Capacitor } from '@capacitor/core'
import schema from '../features/storage/schema.sql?raw'
import { nativeData, nativeSql } from '../features/storage/native'
import { SqliteStorage } from '../features/storage/sqlite'
import { initializePreferences, writePreference } from '../features/preferences/device'
import { R2CloudAdapter } from '../features/cloud/r2/r2'
import { getCredential } from '../features/cloud/credential/credential'
import { createImageStore } from '../features/records/images/files'
import type { BackupState, DeviceBackupState, SyncContext } from '../features/cloud/sync/engine.type'

export const storage = new SqliteStorage(nativeSql)
export const imageStore = createImageStore(storage)
export async function initializeRuntime(): Promise<void> {
  if (!Capacitor.isNativePlatform()) throw new Error('请在 Android 应用中打开')
  const result = await nativeData.initialize({ schema })
  initializePreferences(result.preferences)
  await storage.inspect()
}
export function currentCloud(): R2CloudAdapter | undefined {
  const config = getCredential()
  return config ? new R2CloudAdapter(config) : undefined
}
const deadline = <T>(work: Promise<T>, message: string) => withDeadline(work, 30_000, message)
export function syncContext(confirmConflict: SyncContext['confirmConflict'], progress: SyncContext['progress']): SyncContext {
  return {
    begin: (operationId) => deadline(nativeData.beginSync({ operationId }), '同步初始化超时'),
    end: (operationId) => deadline(nativeData.endSync({ operationId }), '同步结束超时'),
    prepare: (operationId, folder) => deadline(nativeData.prepareTransfer({ operationId, folder }), '工作目录准备超时'),
    snapshot: (operationId) => deadline(nativeData.snapshot({ operationId }), '数据库快照超时'),
    info: async (path, verify = false) => (await deadline(nativeData.fileInfo({ path, verify }), '文件检查超时')).file,
    activate: (operationId, path, images, namespace, state) => deadline(nativeData.activate({ operationId, path, images, receipt: { key: 'sync-state', value: JSON.stringify({ ...state, namespace }) } }), '安装数据库超时'),
    adoptImage: (operationId, source, path) => deadline(nativeData.adoptImage({ operationId, source, path }), '图片恢复超时'),
    align: (operationId, paths) => deadline(nativeData.alignImages({ operationId, paths }), '图片对齐超时'),
    freeSpace: async () => (await deadline(nativeData.availableSpace(), '存储空间检查超时')).bytes,
    async loadState(namespace): Promise<BackupState> {
      const { value: text } = await deadline(nativeData.readPreference({ key: 'sync-state' }), '同步状态读取超时')
      try {
        if (!text) return { revision: 0, sequence: 0 }
        const { namespace: savedNamespace, ...state }: DeviceBackupState = JSON.parse(text)
        if (savedNamespace !== namespace) return { revision: 0, sequence: 0 }
        if (![state.revision, state.sequence].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new Error()
        if (state.revision > 0 && !/^[a-f0-9]{64}$/.test(state.sha256 ?? '')) throw new Error()
        return state
      } catch { throw new Error('同步状态损坏') }
    },
    saveState: (namespace, state) => deadline(writePreference('sync-state', JSON.stringify({ ...state, namespace })), '同步状态保存超时'),
    confirmConflict, progress,
    async observe(operationId, onBytes) {
      const listener = await deadline(nativeData.addListener('transferProgress', (event) => { if (event.operationId === operationId) onBytes(event.key, event.bytes) }), '进度事件订阅超时')
      return () => withDeadline(listener.remove(), 5_000, '进度事件释放超时')
    },
  }
}
