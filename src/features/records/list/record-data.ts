/**
 * 记录页数据层：以整月为加载单元。
 *
 * 只读取最早/最新记录时刻来确定回溯边界，真正放入列表的数据仍来自按月查询；
 * 这样既能避免空月份导致的无界回溯，也不把 IndexedDB 查询细节带进 UI。
 */
import type { LifeRecord } from '../type'
import { monthOf, previousMonth } from '../../../utils/time'
import type { InitialRecordLoad } from './record-list.type'
import type { StorageAdapter } from '../../storage/type'

const INITIAL_RECORD_COUNT = 10

async function loadMonth(
  storage: StorageAdapter,
  month: string,
): Promise<LifeRecord[]> {
  return storage.getRecordsInMonth(month)
}

export async function loadInitialRecords(
  storage: StorageAdapter,
  now: Date = new Date(),
): Promise<InitialRecordLoad> {
  const bounds = await storage.getRecordTimeBounds()
  if (!bounds) {
    return { records: [], earliestMonth: undefined, nextMonth: undefined }
  }

  const earliestMonth = monthOf(bounds.earliest)
  const records: LifeRecord[] = []
  const referenceMonth = monthOf(now)
  const latestMonth = monthOf(bounds.latest)
  let month = latestMonth > referenceMonth ? latestMonth : referenceMonth

  for (;;) {
    records.push(...(await loadMonth(storage, month)))
    if (
      records.length >= INITIAL_RECORD_COUNT ||
      month === earliestMonth
    ) {
      break
    }
    month = previousMonth(month)
  }

  return {
    records,
    earliestMonth,
    nextMonth:
      earliestMonth && month !== earliestMonth ? previousMonth(month) : undefined,
  }
}

export async function loadOlderRecords(
  storage: StorageAdapter,
  month: string,
): Promise<LifeRecord[]> {
  return loadMonth(storage, month)
}
