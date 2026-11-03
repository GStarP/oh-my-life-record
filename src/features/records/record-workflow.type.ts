import type { StorageAdapter } from '../storage/type'
import type { ImageStore } from './images/files.type'
import type { DraftImage } from './images/image-import.type'
import type { LifeRecord } from './type'
export type RecordWorkflowDependencies = { storage: StorageAdapter; images: ImageStore }
export type RecordWorkflow = {
  save(record: LifeRecord, drafts?: DraftImage[]): Promise<void>
  delete(record: LifeRecord): Promise<void>
}
