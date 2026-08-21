/**
 * 记录列表的数据纯函数。
 *
 * 不依赖 React；页面只负责加载月份和渲染结果，日历边界统一由此处按 UTC+8
 * 处理，避免设备时区影响「今天/昨天」标签。
 */
import { differenceInCalendarDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import type { LifeRecord } from '../type'
import { dayKeyOf, wallDate } from '../../../utils/time'
import type { RecordDayGroup } from './record-list.type'

function labelForDay(dayKey: string, referenceDay: string): string {
  const distance = differenceInCalendarDays(wallDate(referenceDay), wallDate(dayKey))
  if (distance === 0) return '今天'
  if (distance === 1) return '昨天'
  const year = formatInTimeZone(wallDate(dayKey), 'UTC', 'yyyy')
  const referenceYear = formatInTimeZone(wallDate(referenceDay), 'UTC', 'yyyy')
  return year === referenceYear
    ? formatInTimeZone(wallDate(dayKey), 'UTC', 'M月d日')
    : formatInTimeZone(wallDate(dayKey), 'UTC', 'yyyy年M月d日')
}

/** 仅匹配完整类型；空查询返回原数组，交给调用方保留当前列表顺序。 */
export function filterRecordsByType(
  records: LifeRecord[],
  query: string,
): LifeRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return records
  return records.filter(
    (record) => record.type.trim().toLocaleLowerCase() === normalizedQuery,
  )
}

export function groupRecordsByDay(
  records: LifeRecord[],
  now: Date = new Date(),
): RecordDayGroup[] {
  const referenceDay = dayKeyOf(now)
  const grouped = new Map<string, LifeRecord[]>()
  for (const record of records) {
    const key = dayKeyOf(record.time)
    const items = grouped.get(key)
    if (items) items.push(record)
    else grouped.set(key, [record])
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, items]) => ({
      key,
      label: labelForDay(key, referenceDay),
      records: items,
    }))
}
