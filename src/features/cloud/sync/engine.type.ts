import type { CloudAdapter } from '../cloud.type'
import type { NativeFile } from '../../storage/native.type'
import type { StorageAdapter } from '../../storage/type'

export type BackupState = { revision: number; sequence: number; sha256?: string; pending?: { revision: number; sequence: number; sha256: string } }
export type SyncProgress = { stage: string; files: number; totalFiles: number; bytes: number; totalBytes: number }
export type SyncOutcome = 'uploaded' | 'downloaded' | 'already-latest' | 'aborted'
export type SyncContext = {
  begin(id: string): Promise<void>
  end(id: string): Promise<void>
  prepare(id: string, folder: string): Promise<void>
  snapshot(id: string): Promise<NativeFile>
  info(path: string, verify?: boolean): Promise<NativeFile | undefined>
  activate(id: string, path: string, images: string[], namespace: string, state: BackupState): Promise<void>
  adoptImage(id: string, source: string, path: string): Promise<void>
  align(id: string, paths: string[]): Promise<void>
  freeSpace(): Promise<number>
  loadState(namespace: string): Promise<BackupState>
  saveState(namespace: string, state: BackupState): Promise<void>
  confirmConflict(): Promise<boolean>
  progress(progress: SyncProgress): void | Promise<void>
  observe(id: string, onBytes: (key: string, bytes: number) => void): Promise<() => Promise<void>>
}
export type SyncDependencies = { storage: StorageAdapter; cloud: CloudAdapter; context: SyncContext }

export type TransferFile = { path: string; bytes: number }

export type DeviceBackupState = BackupState & { namespace: string }
