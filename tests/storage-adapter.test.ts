/**
 * StorageAdapter 的两个 Adapter 共用同一组公开契约测试；这里补充的内容
 * 只覆盖 IndexedDB 独有的事务回滚行为，避免重复测试普通读写语义。
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { LifeRecord } from '../src/features/records/type'
import { IndexedDbStorage } from '../src/features/storage/indexeddb'
import { InMemoryStorage } from './helpers/inmemory.storage'
import { defineStorageAdapterContract } from './storage-adapter.contract'
import { recordFixture } from './helpers/record'

let sequence = 0

/** 每个测试使用独立数据库，避免 IndexedDB 状态跨用例污染。 */
function freshStorage(): IndexedDbStorage {
  sequence += 1
  return new IndexedDbStorage(`storage-contract-${sequence}`)
}

defineStorageAdapterContract('IndexedDbStorage', freshStorage)
defineStorageAdapterContract('InMemoryStorage', () => new InMemoryStorage())

describe('IndexedDbStorage：事务回滚', () => {
  it('记录写入失败时，记录和 dirty 状态都保持原样', async () => {
    // 这是 IndexedDB 事务特有的可靠性保证：即使结构化克隆在事务中途失败，
    // 也不能留下“记录已改但 dirty 未落盘”的状态。
    const storage = freshStorage()
    const old = recordFixture('old', '2026-08-15T10:00:00+08:00')
    await storage.upsertRecordAndMarkDirty(old, [])
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 6,
      dirty: false,
    })
    const poison = {
      ...old,
      description: '不会提交',
      attributes: { bad: () => {} },
    } as unknown as LifeRecord

    await expect(
      storage.upsertRecordAndMarkDirty(poison, ['2026-08']),
    ).rejects.toThrow()
    await expect(storage.getRecordsInMonth('2026-08')).resolves.toEqual([old])
    await expect(storage.getPartitionState('2026-08')).resolves.toEqual({
      month: '2026-08',
      remoteRevision: 6,
      dirty: false,
    })
  })

  it('分片替换中途失败时，旧记录和同步状态都保持原样', async () => {
    // 分片下载会先删除目标月旧记录再写入云端全集；事务必须保证写入失败时
    // 回滚删除动作，避免用户的本地数据被静默清空。
    const storage = freshStorage()
    const local = recordFixture('local', '2026-08-05T10:00:00+08:00')
    await storage.upsertRecordAndMarkDirty(local, [])
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: true,
    })
    const poison = {
      ...recordFixture('cloud', '2026-08-01T09:00:00+08:00'),
      attributes: { bad: () => {} },
    } as unknown as LifeRecord

    await expect(
      storage.replacePartition({
        month: '2026-08',
        revision: 7,
        records: [poison],
      }),
    ).rejects.toThrow()
    await expect(storage.getRecordsInMonth('2026-08')).resolves.toEqual([local])
    await expect(storage.getPartitionState('2026-08')).resolves.toEqual({
      month: '2026-08',
      remoteRevision: 3,
      dirty: true,
    })
  })
})
