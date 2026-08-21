import type { StorageAdapter } from '../storage/type'
import type { RecordTypeTemplate } from './type'

export type TypeTemplateWorkflow = {
  list: () => Promise<RecordTypeTemplate[]>
  find: (type: string) => Promise<RecordTypeTemplate | undefined>
  save: (template: RecordTypeTemplate, editingType?: string) => Promise<void>
  remove: (type: string) => Promise<void>
}

export type TypeTemplateWorkflowOptions = {
  storage: StorageAdapter
}
