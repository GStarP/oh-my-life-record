/**
 * 记录集合的应用级 Jotai 状态。
 *
 * 页面只是订阅和发起操作；加载结果、月份边界和错误不会因为页面路由
 * 切换而重置，后台同步也可以通过 updateRecordData 写入同一份状态。
 */
import { getDefaultStore } from 'jotai/vanilla'
import { atom } from 'jotai'
import type {
  RecordDataState,
  RecordDataUpdater,
} from './record-data-state.type'

const recordStore = getDefaultStore()

export const recordDataAtom = atom<RecordDataState>({
  records: [],
  initialStatus: 'idle',
  olderStatus: 'idle',
})

export function getRecordData(): RecordDataState {
  return recordStore.get(recordDataAtom)
}

export function updateRecordData(updater: RecordDataUpdater): void {
  recordStore.set(recordDataAtom, updater)
}
