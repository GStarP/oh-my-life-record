/** 记录集合的应用级状态。 */
import type { LifeRecord } from '../type'

export type RecordDataLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type RecordDataState = {
  /** 已加载的记录快照；它不属于某个页面实例。 */
  records: LifeRecord[]
  nextMonth?: string
  earliestMonth?: string
  initialStatus: RecordDataLoadStatus
  initialError?: string
  olderStatus: RecordDataLoadStatus
  olderError?: string
}

export type RecordDataUpdater = (
  current: RecordDataState,
) => RecordDataState
