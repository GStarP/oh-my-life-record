import { describe, expect, it } from 'vitest'
import { createTestStorage } from './helpers/sqlite'
import { recordFixture } from './helpers/record'
import type { ImageFile } from '../src/features/storage/type'

const image: ImageFile = { id: 'shared', path: 'images/shared.webp', mime: 'image/webp', bytes: 3, sha256: 'a'.repeat(64) }

describe('SQLite 业务存储', () => {
  it('跨页排序稳定，类型筛选查询全部记录，并保留毫秒和属性值', async () => {
    // 同一毫秒的记录必须通过 ID 排序继续翻页，否则会遗漏或重复。
    // 筛选目标放在第二页之外，验证筛选发生在 SQL 查询中，且 false、0 和多行正文原样返回。
    const { storage, database } = createTestStorage()
    try {
      for (let i = 0; i < 61; i++) await storage.saveRecord(recordFixture(String(i).padStart(3, '0'), '2028-01-01T00:00:00.123Z', { type: i === 0 ? ' 阅读 ' : '阅读-摘录', description: '第一行\n第二行', attributes: { 完成: false, 数量: 0 } }))
      const first = await storage.queryRecords()
      const second = await storage.queryRecords({ cursor: first.cursor })
      expect(first.records).toHaveLength(50)
      expect(new Set([...first.records, ...second.records].map((record) => record.id)).size).toBe(61)
      expect(second.cursor).toBeUndefined()
      const filtered = await storage.queryRecords({ type: '阅读' })
      expect(filtered.records).toHaveLength(1)
      expect(filtered.records[0]).toMatchObject({ id: '000', attributes: { 完成: false, 数量: 0 }, description: '第一行\n第二行' })
      expect(filtered.records[0].time.getTime() % 1000).toBe(123)
    } finally { database.close() }
  })
  it('共享图片只在最后一个引用删除后移除，失败事务不改变记录和修改序号', async () => {
    // 两条记录共享同一文件。删除一个引用不能删除文件；插入不存在的图片引用必须整笔回滚。
    // 最后删除剩余记录时，返回唯一的失去引用的文件，让文件层安全删除本体。
    const { storage, database } = createTestStorage()
    try {
      const a = recordFixture('a', '2026-10-01T00:00:00Z', { images: ['shared'] })
      await storage.saveRecord(a, [image])
      await storage.saveRecord({ ...a, id: 'b' })
      expect(await storage.deleteRecord('a')).toEqual([])
      const before = await storage.inspect()
      await expect(storage.saveRecord({ ...a, id: 'b', images: ['missing'] })).rejects.toThrow()
      expect((await storage.inspect()).sequence).toBe(before.sequence)
      expect((await storage.queryRecords()).records[0].images).toEqual(['shared'])
      expect(await storage.deleteRecord('b')).toEqual([image])
      expect(await storage.getImage('shared')).toBeUndefined()
    } finally { database.close() }
  })
})
