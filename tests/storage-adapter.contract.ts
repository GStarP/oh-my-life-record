/**
 * StorageAdapter 公开契约：所有 Adapter 都必须满足的可观察行为。
 *
 * 这里不测试 IndexedDB 游标或内存 Map 等实现细节；同一组行为测试
 * 分别运行在 InMemoryStorage 与 IndexedDbStorage 上，防止测试替身和真实
 * 存储的语义发生漂移。
 */
import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../src/features/storage/type'
import type { RecordTypeTemplate } from '../src/features/type-templates/type'
import type { LifeRecord } from '../src/features/records/type'
import { recordFixture } from './helpers/record'

/** 用公开原子写入口建立读取测试的初始记录，不制造无关 dirty 月份。 */
async function seedRecord(
  storage: StorageAdapter,
  record: LifeRecord,
): Promise<void> {
  await storage.upsertRecordAndMarkDirty(record, [])
}

export function defineStorageAdapterContract(
  name: string,
  createStorage: () => StorageAdapter,
): void {
  describe(`${name}: StorageAdapter 契约`, () => {
    it('清空全部业务数据与同步状态后，可以从零重新记录', async () => {
      // 手机清空不能只删列表：暂存图片、模板和两类同步状态都必须清除，
      // 否则旧图片占空间或新数据沿用旧 revision。保留数据库结构后应仍能
      // 正常写入和按时间查询，新分片从 remoteRevision=0 开始；重复清空也应成功。
      const storage = createStorage()
      await storage.upsertRecordAndMarkDirty(
        recordFixture('old', '2026-08-14T10:00:00+08:00'),
        ['2026-08'],
      )
      await storage.putImageBlob('old-image', new Blob(['old image']))
      await storage.putTypeTemplateAndMarkDirty({ type: '旧模板', icon: 'wallet', attributes: [] })
      await storage.putPartitionState({ month: '2026-08', remoteRevision: 9, dirty: true })
      await storage.putTypeTemplateState({ remoteRevision: 4, dirty: true })

      await storage.clearAllData()
      await storage.clearAllData()
      await expect(storage.getAllRecords()).resolves.toEqual([])
      await expect(storage.getStagedImages()).resolves.toEqual([])
      await expect(storage.getAllPartitionStates()).resolves.toEqual([])
      await expect(storage.getTypeTemplates()).resolves.toEqual([])
      await expect(storage.getTypeTemplateState()).resolves.toBeUndefined()

      const fresh = recordFixture('new', '2026-08-14T11:00:00+08:00', { name: '重新开始' })
      await storage.upsertRecordAndMarkDirty(fresh, ['2026-08'])
      await expect(storage.getRecordsInMonth('2026-08')).resolves.toEqual([fresh])
      await expect(storage.getPartitionState('2026-08')).resolves.toEqual({
        month: '2026-08', remoteRevision: 0, dirty: true,
      })
    })

    it('按 UTC+8 月份读取记录，并保持时间与同刻 ID 的确定性顺序', async () => {
      // 月份读取是列表加载和生成月度云端快照的共同基础；同一时刻的记录
      // 也必须保持固定顺序，否则内存替身与真实 IndexedDB 会产生不同快照。
      const storage = createStorage()
      await seedRecord(storage,
        recordFixture('same-a', '2026-08-02T10:00:00+08:00'),
      )
      await seedRecord(storage,
        recordFixture('same-b', '2026-08-02T10:00:00+08:00'),
      )
      await seedRecord(storage,
        recordFixture('older', '2026-08-01T10:00:00+08:00'),
      )
      await seedRecord(storage,
        recordFixture('other-month', '2026-07-31T23:00:00+08:00'),
      )

      await expect(storage.getRecordsInMonth('2026-08')).resolves.toEqual([
        recordFixture('same-b', '2026-08-02T10:00:00+08:00'),
        recordFixture('same-a', '2026-08-02T10:00:00+08:00'),
        recordFixture('older', '2026-08-01T10:00:00+08:00'),
      ])
    })

    it('返回全部记录和最早/最新时间边界', async () => {
      // 图片清理需要全部记录的图片引用，记录列表只需要时间边界；两个查询
      // 都是公开契约，不能因为某个 Adapter 内部使用索引就改变结果语义。
      const storage = createStorage()
      const oldRecord = recordFixture('old', '2026-07-01T10:00:00+08:00')
      const newRecord = recordFixture('new', '2026-09-01T10:00:00+08:00')
      await seedRecord(storage, oldRecord)
      await seedRecord(storage, newRecord)

      await expect(
        storage.getAllRecords().then((records) =>
          records.map((record) => record.id).sort(),
        ),
      ).resolves.toEqual(['new', 'old'])
      await expect(storage.getRecordTimeBounds()).resolves.toEqual({
        earliest: new Date('2026-07-01T02:00:00.000Z'),
        latest: new Date('2026-09-01T02:00:00.000Z'),
      })
    })

    it('原子记录操作会同时写入记录和 dirty 状态', async () => {
      // 记录内容与 dirty 是一个业务事实：调用方不能观察到“记录已改但不会
      // 同步”的中间状态，所以两个操作必须通过同一公开方法完成。
      // 名称与长描述必须独立保留；仅修改名称后，两个读取入口仍应返回完整描述。
      const storage = createStorage()
      await storage.putPartitionState({
        month: '2026-08',
        remoteRevision: 4,
        dirty: false,
      })
      const record = recordFixture('atomic', '2026-08-14T10:00:00+08:00', {
        name: '读完一本书',
        description: '第一段\n\n' + '完整正文。'.repeat(100) + '\n最后一段',
      })

      await storage.upsertRecordAndMarkDirty(record, ['2026-08'])
      expect(await storage.getRecordsInMonth('2026-08')).toEqual([record])
      expect((await storage.getPartitionState('2026-08'))?.dirty).toBe(true)

      const renamed = { ...record, name: '读书笔记' }
      await storage.upsertRecordAndMarkDirty(renamed, ['2026-08'])
      await expect(storage.getRecordsInMonth('2026-08')).resolves.toEqual([renamed])
      await expect(storage.getAllRecords()).resolves.toEqual([renamed])

      await storage.deleteRecordAndMarkDirty(record.id, '2026-08')
      expect(await storage.getRecordsInMonth('2026-08')).toEqual([])
      expect((await storage.getPartitionState('2026-08'))?.dirty).toBe(true)
    })

    it('同步状态支持单月读取和全量读取', async () => {
      // 同步引擎根据这些状态判断上传、下载和冲突；未写入的月份必须保持
      // undefined，不能被 Adapter 自行伪造为已同步。
      const storage = createStorage()
      await expect(storage.getPartitionState('2026-08')).resolves.toBeUndefined()
      await storage.putPartitionState({
        month: '2026-07',
        remoteRevision: 1,
        dirty: false,
      })
      await storage.putPartitionState({
        month: '2026-08',
        remoteRevision: 2,
        dirty: true,
      })

      await expect(storage.getPartitionState('2026-08')).resolves.toEqual({
        month: '2026-08',
        remoteRevision: 2,
        dirty: true,
      })
      await expect(
        storage.getAllPartitionStates().then((states) =>
          states.sort((left, right) => left.month.localeCompare(right.month)),
        ),
      ).resolves.toEqual([
        { month: '2026-07', remoteRevision: 1, dirty: false },
        { month: '2026-08', remoteRevision: 2, dirty: true },
      ])
    })

    it('分片替换只影响目标月份，并复位目标月份同步状态', async () => {
      // 下载是整月替换：目标月的旧记录必须被云端全集替换，其他月份不能
      // 被误删，目标月 dirty 必须随云端 revision 原子复位。
      const storage = createStorage()
      const august = recordFixture('august-local', '2026-08-05T10:00:00+08:00')
      const july = recordFixture('july-local', '2026-07-05T10:00:00+08:00')
      const cloudAugust = recordFixture(
        'august-cloud',
        '2026-08-01T09:00:00+08:00',
      )
      await seedRecord(storage, august)
      await seedRecord(storage, july)
      await storage.putPartitionState({
        month: '2026-08',
        remoteRevision: 3,
        dirty: true,
      })
      await storage.putPartitionState({
        month: '2026-07',
        remoteRevision: 9,
        dirty: false,
      })

      await storage.replacePartition({
        month: '2026-08',
        revision: 7,
        records: [cloudAugust],
      })

      await expect(storage.getRecordsInMonth('2026-08')).resolves.toEqual([
        cloudAugust,
      ])
      await expect(storage.getRecordsInMonth('2026-07')).resolves.toEqual([
        july,
      ])
      await expect(storage.getPartitionState('2026-08')).resolves.toEqual({
        month: '2026-08',
        remoteRevision: 7,
        dirty: false,
      })
      await expect(storage.getPartitionState('2026-07')).resolves.toEqual({
        month: '2026-07',
        remoteRevision: 9,
        dirty: false,
      })
    })

    it('图片暂存支持写入、读取、列举和删除', async () => {
      // 图片暂存区的语义是“存在即待上传”；上传成功或孤儿清理后删除，
      // 因此 Blob 内容和 createdAt 都必须通过同一 StorageAdapter 契约保留。
      const storage = createStorage()
      const blob = new Blob(['图片字节'], { type: 'image/webp' })
      const createdAt = Date.parse('2026-08-01T00:00:00Z')
      await storage.putImageBlob('img-1', blob, createdAt)

      await expect(storage.getImageBlob('img-1')).resolves.toBeDefined()
      await expect(storage.getStagedImages()).resolves.toEqual([
        { id: 'img-1', blob, createdAt },
      ])

      await storage.deleteImageBlob('img-1')
      await expect(storage.getImageBlob('img-1')).resolves.toBeUndefined()
    })

    it('类型模板支持按类型读写，并把修改标记为全局 dirty', async () => {
      // 类型模板不是记录属性的复制品，而是独立的全局用户数据；写入或删除
      // 任意模板都必须让同一个全局同步状态变 dirty，供同步引擎统一上传。
      const storage = createStorage()
      const template: RecordTypeTemplate = {
        type: '记账',
        icon: 'wallet',
        attributes: [
          { name: '分类', kind: 'option', options: ['吃喝', '购物'] },
          { name: '费用', kind: 'number' },
        ],
      }

      await expect(storage.getTypeTemplate('记账')).resolves.toBeUndefined()
      await storage.putTypeTemplateAndMarkDirty(template)
      await expect(storage.getTypeTemplate('记账')).resolves.toEqual(template)
      await expect(storage.getTypeTemplates()).resolves.toEqual([template])
      await expect(storage.getTypeTemplateState()).resolves.toEqual({
        remoteRevision: 0,
        dirty: true,
      })

      await storage.deleteTypeTemplateAndMarkDirty('记账')
      await expect(storage.getTypeTemplates()).resolves.toEqual([])
      await expect(storage.getTypeTemplateState()).resolves.toEqual({
        remoteRevision: 0,
        dirty: true,
      })
    })

    it('替换类型模板集合会清除旧模板并原子复位同步状态', async () => {
      // 下载是云端集合的完整替换：本地已删除的模板不能残留；revision 与
      // dirty 必须一起落库，否则页面可能显示新模板但下一次同步又重复上传。
      const storage = createStorage()
      await storage.putTypeTemplateAndMarkDirty({
        type: '旧类型',
        icon: 'library',
        attributes: [],
      })
      const replacement: RecordTypeTemplate = {
        type: '新类型',
        icon: 'book-open',
        attributes: [{ name: '费用', kind: 'number' }],
      }

      await storage.replaceTypeTemplates([replacement], 7)

      await expect(storage.getTypeTemplates()).resolves.toEqual([replacement])
      await expect(storage.getTypeTemplate('旧类型')).resolves.toBeUndefined()
      await expect(storage.getTypeTemplateState()).resolves.toEqual({
        remoteRevision: 7,
        dirty: false,
      })
    })
  })
}
