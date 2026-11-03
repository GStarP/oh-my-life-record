/** 记录列表的固定 UTC+8 日分组及类型匹配规则。 */
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

/** 保存后合并当前页时保留类型筛选，避免不匹配的新记录进入列表。 */
export function filterRecordsByType(
  records: LifeRecord[],
  query: string,
): LifeRecord[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return records
  return records.filter(
    (record) => record.type.trim().toLowerCase() === normalizedQuery,
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
