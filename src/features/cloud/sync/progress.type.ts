import type { SyncProgress } from './engine.type'

export type SyncProgressPublisher = (progress: SyncProgress) => void
export type SyncProgressDisplay = {
  update(progress: SyncProgress): Promise<void>
  finish(): Promise<void>
}
