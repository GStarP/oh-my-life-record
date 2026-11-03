/** 记录列表的日期分组、保存后当前页筛选回归。 */
import { describe, expect, it } from 'vitest'
import { filterRecordsByType, groupRecordsByDay } from '../src/features/records/list/record-list'
import { recordFixture } from './helpers/record'

describe('groupRecordsByDay', () => {
  it('按 UTC+8 日历日分组并生成今天/昨天/日期标签', () => {
    // 参考时刻是北京时间 2026-08-14 08:30；两个边界记录只相差一秒，
    // 但分别落在昨天 23:59:59 与今天 00:00:00，不能按 UTC 日期直接分组。
    const now = new Date('2026-08-14T00:30:00.000Z')
    const records = [
      recordFixture('yesterday', '2026-08-13T15:59:59.000Z'),
      recordFixture('today', '2026-08-13T16:00:00.000Z'),
      recordFixture('older', '2026-08-12T04:00:00.000Z'),
      recordFixture('last-year', '2025-08-12T04:00:00.000Z'),
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
    // 保存记录后会合并当前页，类型不匹配的新记录必须留在当前筛选外。
    // 空查询保留原顺序；非空查询只接受去首尾空格后的完整类型。
    const records = [
      recordFixture('exact', '2026-08-14T00:00:00.000Z', { type: '日常' }),
      recordFixture('compound', '2026-08-13T00:00:00.000Z', { type: '日常-运动' }),
      recordFixture('other', '2026-08-12T00:00:00.000Z', { type: '阅读' }),
    ]
    expect(filterRecordsByType(records, ' 日常 ')).toEqual([records[0]])
    expect(filterRecordsByType(records, '')).toBe(records)
  })
})
