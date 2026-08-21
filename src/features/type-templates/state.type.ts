/** 类型模板集合的应用级状态。 */
import type { RecordTypeTemplate } from './type'

export type TypeTemplateLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type TypeTemplateDataState = {
  templates: RecordTypeTemplate[]
  status: TypeTemplateLoadStatus
  error?: string
}

export type TypeTemplateDataUpdater = (
  current: TypeTemplateDataState,
) => TypeTemplateDataState
