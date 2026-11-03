import type { SyncProgress } from './engine.type'

export type ConflictDialogState = { resolve: (confirmed: boolean) => void }
export type ConflictDialogProps = { state: ConflictDialogState | undefined }
export type SyncProgressDialogProps = { open: boolean; progress: SyncProgress | undefined }
