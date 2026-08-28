/**
 * 记录列表纯函数测试。
 *
 * 只锁定按天分组这个与 UI 无关的公开行为；React 渲染、滚动和 Chakra 组件
 * 不在测试接缝内。重点是 UTC+8 边界，避免设备时区把午夜前后的记录分错天。
 */
import { describe, expect, it } from 'vitest'
import type { LifeRecord } from '../src/features/records/type'
import { loadInitialRecords } from '../src/features/records/list/record-data'
import { filterRecordsByType, groupRecordsByDay } from '../src/features/records/list/record-list'
import { InMemoryStorage } from './helpers/inmemory.storage'

function record(id: string, time: string): LifeRecord {
  return {
    id,
    time: new Date(time),
    type: '日常',
    name: '',
    description: id,
    images: [],
    attributes: {},
  }
}

describe('groupRecordsByDay', () => {
  it('按 UTC+8 日历日分组并生成今天/昨天/日期标签', () => {
    // 参考时刻是北京时间 2026-08-14 08:30；两个边界记录只相差一秒，
    // 但分别落在昨天 23:59:59 与今天 00:00:00，不能按 UTC 日期直接分组。
    const now = new Date('2026-08-14T00:30:00.000Z')
    const records = [
      record('yesterday', '2026-08-13T15:59:59.000Z'),
      record('today', '2026-08-13T16:00:00.000Z'),
      record('older', '2026-08-12T04:00:00.000Z'),
      record('last-year', '2025-08-12T04:00:00.000Z'),
    ]

    const groups = groupRecordsByDay(records, now)

    expect(groups.map((group) => [group.key, group.label])).toEqual([
      ['2026-08-14', '今天'],
      ['2026-08-13', '昨天'],
      ['2026-08-12', '8月12日'],
      ['2025-08-12', '2025年8月12日'],
    ])
    expect(groups[0].records.map((item) => item.id)).toEqual(['today'])
    expect(groups[1].records.map((item) => item.id)).toEqual(['yesterday'])
  })
})

describe('filterRecordsByType', () => {
  it('只匹配完整类型，不把输入中的片段当作结果', () => {
    // 类型筛选是提交后的精确匹配：输入「日常」只能命中「日常」，
    // 不能把「日常-运动」等包含该片段的记录一起筛出来。
    const records = [
      record('exact', '2026-08-14T00:00:00.000Z'),
      { ...record('compound', '2026-08-13T00:00:00.000Z'), type: '日常-运动' },
      { ...record('other', '2026-08-12T00:00:00.000Z'), type: '阅读' },
    ]

    expect(filterRecordsByType(records, ' 日常 ')).toEqual([records[0]])
    expect(filterRecordsByType(records, '')).toBe(records)
  })
})

describe('loadInitialRecords', () => {
  it('记录全部在参考时刻之后时仍从最新月份开始加载，不会无限向过去回溯', async () => {
    // 用户可能预先录入未来行程；如果加载器固定从当前月向前减月份，
    // 最早月份反而在未来时会永远到不了，页面会一直停在加载中。
    const storage = new InMemoryStorage()
    const future = record('future', '2026-09-01T02:00:00.000Z')
    await storage.upsertRecord(future)

    const result = await loadInitialRecords(
      storage,
      new Date('2026-08-14T00:00:00.000Z'),
    )

    expect(result.records).toEqual([future])
    expect(result.earliestMonth).toBe('2026-09')
    expect(result.nextMonth).toBeUndefined()
  })
})
