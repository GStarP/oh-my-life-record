/**
 * 与具体业务能力无关的固定 UTC+8 时间换算。
 *
 * 记录的 Date 表示绝对瞬间；只有月份归属、日分组和编辑器输入输出需要
 * 转成北京时间墙钟，不能直接依赖设备本地时区。
 */
import { addMonths } from 'date-fns'
import { UTCDate } from '@date-fns/utc'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export const UTC8_ZONE = 'Etc/GMT-8'

export function monthOf(time: Date): string {
  return formatInTimeZone(time, UTC8_ZONE, 'yyyy-MM')
}

export function dayKeyOf(time: Date): string {
  return formatInTimeZone(time, UTC8_ZONE, 'yyyy-MM-dd')
}

export function formatTimeOfDay(time: Date): string {
  return formatInTimeZone(time, UTC8_ZONE, 'HH:mm')
}

export function formatDateTimeInput(time: Date): string {
  return formatInTimeZone(time, UTC8_ZONE, "yyyy-MM-dd'T'HH:mm")
}

export function parseDateTimeInput(value: string): Date {
  return fromZonedTime(value, UTC8_ZONE)
}

/** 返回 UTC+8 墙钟意义上的上一个自然月。 */
export function previousMonth(month: string): string {
  const wallStart = new UTCDate(`${month}-01T00:00:00Z`)
  return formatInTimeZone(addMonths(wallStart, -1), 'UTC', 'yyyy-MM')
}

/** 把 YYYY-MM-DD 墙钟日期转成仅用于日历计算的 UTCDate。 */
export function wallDate(dayKey: string): UTCDate {
  return new UTCDate(`${dayKey}T00:00:00Z`)
}
