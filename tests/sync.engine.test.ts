/**
 * 同步引擎测试：验证全部同步决策的外部行为。
 *
 * 为什么测它：同步是本应用正确性的核心——方向判定错、冲突未否决、
 * 提交点不幂等，都会造成数据丢失或两端不一致，且极难在运行时发现。
 * 引擎是纯 TS、依赖注入，故用 InMemoryStorage / InMemoryCloud 替身
 * 在 Node 环境断言行为结果，不触碰浏览器。
 *
 * 只测外部行为：断言「发生了什么 + 最终状态」，不断言内部调用序列。
 */
import { describe, it, expect } from 'vitest'
import { checkForUpdates, sync } from '../src/features/cloud/sync/engine'
import { InMemoryStorage } from './helpers/inmemory.storage'
import { InMemoryCloud } from './helpers/inmemory.cloud'
import { recordFixture } from './helpers/record'

/** 供 sync 使用的「总是确认」回调。 */
const alwaysConfirm = async () => true

describe('checkForUpdates：指示器推导（只读，不改数据）', () => {
  it('云端有更新 → download（↓）', async () => {
    // 云端 revision 高于本地已确认值：可下载。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: false,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })

    await expect(checkForUpdates(storage, cloud)).resolves.toBe('download')
  })

  it('本地有未上传修改且云端无更新 → upload（↑）', async () => {
    // 版本一致但本地 dirty：可上传。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 5,
      dirty: true,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })

    await expect(checkForUpdates(storage, cloud)).resolves.toBe('upload')
  })

  it('云端有更新且本地有未上传修改（同月冲突）→ 指示器显示 download（云端更新优先）', async () => {
    // 同月「云端更高 + 本地 dirty」是冲突，在 sync 时判断，不单列按钮状态；
    // 指示器只反映「有下载需求」，显示 ↓。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: true,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })

    await expect(checkForUpdates(storage, cloud)).resolves.toBe('download')
  })

  it('全部一致 → none（无角标）', async () => {
    // 本地确认版本与云端相同且没有未上传修改时，不应误亮上传或下载状态，
    // 否则用户每次进入应用都会看到一个实际无法执行任何工作的同步提示。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 5,
      dirty: false,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })

    await expect(checkForUpdates(storage, cloud)).resolves.toBe('none')
  })

  it('一个月可上传、一个月可下载（不同月）→ both（↑↓ 同时显示）', async () => {
    // 不同月份方向并存：8 月上传、7 月下载，都是正常同步，↑↓ 同时亮。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 5,
      dirty: true,
    })
    await storage.putPartitionState({
      month: '2026-07',
      remoteRevision: 1,
      dirty: false,
    })
    await cloud.putManifest({
      schemaVersion: 1,
      partitions: { '2026-08': 5, '2026-07': 2 },
      typeTemplatesRevision: 0,
    })

    await expect(checkForUpdates(storage, cloud)).resolves.toBe('both')
  })
})

describe('sync：方向判定', () => {
  it('云端更高且本地无修改 → 下载覆盖本地，返回 downloaded', async () => {
    // 纯下载：云端文件全量替换本地该月，状态复位为云端 revision。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(recordFixture('old', '2026-08-01T10:00:00+08:00'))
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: false,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })
    await cloud.putPartitionFile({
      month: '2026-08',
      revision: 5,
      records: [recordFixture('new', '2026-08-10T10:00:00+08:00')],
    })

    const result = await sync(storage, cloud, alwaysConfirm)

    expect(result.outcome).toBe('downloaded')
    expect((await storage.getRecordsInMonth('2026-08')).map((r) => r.id)).toEqual(
      ['new'],
    )
    expect(await storage.getPartitionState('2026-08')).toEqual({
      month: '2026-08',
      remoteRevision: 5,
      dirty: false,
    })
  })

  it('版本一致且本地 dirty → 上传覆盖云端，返回 uploaded', async () => {
    // 纯上传：本地生成月 JSON（revision +1）并 PUT manifest，本地 dirty 复位。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(recordFixture('a', '2026-08-02T10:00:00+08:00'))
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 5,
      dirty: true,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })

    const result = await sync(storage, cloud, alwaysConfirm)

    expect(result.outcome).toBe('uploaded')
    const file = await cloud.getPartitionFile('2026-08')
    expect(file?.revision).toBe(6)
    expect(file?.records.map((r) => r.id)).toEqual(['a'])
    expect((await cloud.getManifest())?.partitions['2026-08']).toBe(6)
    expect(await storage.getPartitionState('2026-08')).toEqual({
      month: '2026-08',
      remoteRevision: 6,
      dirty: false,
    })
  })

  it('全部一致且无修改 → already-latest', async () => {
    // 真正执行同步时也必须识别无事可做的状态，既不改本地/云端数据，
    // 也不把正常空操作误报成上传或下载成功。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 5,
      dirty: false,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })

    await expect(sync(storage, cloud, alwaysConfirm)).resolves.toMatchObject({
      outcome: 'already-latest',
      brokenMonths: [],
    })
  })
})

describe('sync：不同月同时上传与下载', () => {
  it('a 月下载、b 月上传同时完成，返回 synced', async () => {
    // 关键语义：下载与上传按「月」粒度互不干扰。8 月云端有更新（下载）、
    // 7 月本地 dirty（上传），本次同时完成两者。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(recordFixture('jul', '2026-07-05T10:00:00+08:00'))
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: false,
    })
    await storage.putPartitionState({
      month: '2026-07',
      remoteRevision: 1,
      dirty: true,
    })
    await cloud.putManifest({
      schemaVersion: 1,
      partitions: { '2026-08': 5, '2026-07': 1 },
      typeTemplatesRevision: 0,
    })
    await cloud.putPartitionFile({
      month: '2026-08',
      revision: 5,
      records: [recordFixture('aug', '2026-08-10T10:00:00+08:00')],
    })

    const result = await sync(storage, cloud, alwaysConfirm)

    expect(result.outcome).toBe('synced')
    // 8 月被下载覆盖。
    expect((await storage.getRecordsInMonth('2026-08')).map((r) => r.id)).toEqual(
      ['aug'],
    )
    // 7 月被上传，dirty 复位。
    expect((await storage.getPartitionState('2026-07'))?.dirty).toBe(false)
    expect((await cloud.getPartitionFile('2026-07'))?.revision).toBe(2)
  })
})

describe('sync：冲突一票否决', () => {
  it('冲突且确认 → 云端覆盖本地，返回 downloaded', async () => {
    // 云端 revision 更高且本地 dirty 时必须先暴露冲突月份；用户确认后
    // 才允许按云端优先规则覆盖本地，不能静默丢失本地修改。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(recordFixture('local', '2026-08-02T10:00:00+08:00'))
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: true,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })
    await cloud.putPartitionFile({
      month: '2026-08',
      revision: 5,
      records: [recordFixture('cloud', '2026-08-10T10:00:00+08:00')],
    })

    let captured: string[] | undefined
    const result = await sync(storage, cloud, async (months) => {
      captured = months
      return true
    })

    expect(result.outcome).toBe('downloaded')
    // 确认回调收到冲突月份列表（仅月份，无需更细信息）。
    expect(captured).toEqual(['2026-08'])
    // 本地被云端覆盖，本地修改丢失。
    expect((await storage.getRecordsInMonth('2026-08')).map((r) => r.id)).toEqual(
      ['cloud'],
    )
  })

  it('冲突且取消 → 整体中止，本地与云端零变更，返回 aborted', async () => {
    // 用户拒绝云端覆盖时，一票否决必须发生在任何上传或下载之前；
    // 本地记录、dirty、云端分片和 manifest 都应保持原状。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(recordFixture('local', '2026-08-02T10:00:00+08:00'))
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: true,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })
    await cloud.putPartitionFile({
      month: '2026-08',
      revision: 5,
      records: [recordFixture('cloud', '2026-08-10T10:00:00+08:00')],
    })

    const result = await sync(storage, cloud, async () => false)

    expect(result.outcome).toBe('aborted')
    // 本地修改未被覆盖、dirty 保持。
    expect((await storage.getRecordsInMonth('2026-08')).map((r) => r.id)).toEqual(
      ['local'],
    )
    expect((await storage.getPartitionState('2026-08'))?.dirty).toBe(true)
    // 云端文件与 manifest 未被改动。
    expect(
      (await cloud.getPartitionFile('2026-08'))?.records.map((r) => r.id),
    ).toEqual(['cloud'])
    expect((await cloud.getManifest())?.partitions['2026-08']).toBe(5)
  })
})

describe('sync：下载校验失败 → 收集进 brokenMonths', () => {
  it('云端声称有该月但文件缺失 → 不覆盖本地，报告 brokenMonths', async () => {
    // manifest 说 2026-08 版本为 5，但云端文件读不到（缺失/损坏）：
    // 不覆盖本地、不持久化任何状态，仅在返回报告里列出该月，供 UI 弹窗提示。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(recordFixture('local', '2026-08-02T10:00:00+08:00'))
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: false,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })
    // 未 putPartitionFile：模拟云端文件缺失。

    const result = await sync(storage, cloud, alwaysConfirm)

    expect(result.outcome).toBe('already-latest')
    expect(result.brokenMonths).toEqual(['2026-08'])
    // 本地同步状态未被改动（不持久化损坏状态）。
    expect(await storage.getPartitionState('2026-08')).toEqual({
      month: '2026-08',
      remoteRevision: 3,
      dirty: false,
    })
    // 本地记录未被覆盖。
    expect((await storage.getRecordsInMonth('2026-08')).map((r) => r.id)).toEqual(
      ['local'],
    )
  })

  it('分片 revision 与 manifest 不一致 → 不覆盖本地，报告 brokenMonths', async () => {
    // manifest 是云端提交点；如果分片文件来自另一次未提交的写入，
    // 就不能把它当成 manifest 指向的版本落到本地，否则下一次检查会
    // 错误地把本地版本当成领先云端。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(recordFixture('local', '2026-08-02T10:00:00+08:00'))
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: false,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })
    await cloud.putPartitionFile({
      month: '2026-08',
      revision: 6,
      records: [recordFixture('unexpected', '2026-08-10T10:00:00+08:00')],
    })

    const result = await sync(storage, cloud, alwaysConfirm)

    expect(result.outcome).toBe('already-latest')
    expect(result.brokenMonths).toEqual(['2026-08'])
    expect((await storage.getRecordsInMonth('2026-08')).map((r) => r.id)).toEqual(
      ['local'],
    )
    expect(await storage.getPartitionState('2026-08')).toEqual({
      month: '2026-08',
      remoteRevision: 3,
      dirty: false,
    })
  })
})

describe('sync：图片上传集合（仅「被引用且本地暂存存在」）', () => {
  it('只传被记录引用且暂存存在的图；孤儿与已上传图都不传', async () => {
    // img1：被引用 + 暂存存在 → 上传，且上传后删除暂存。
    // img2：暂存存在 + 无记录引用（孤儿）→ 不上传。
    // img3：被引用 + 暂存不存在（已上传）→ 不上传。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(
      recordFixture('a', '2026-08-02T10:00:00+08:00', {
        images: ['img1', 'img3'],
      }),
    )
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 5,
      dirty: true,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })
    await storage.putImageBlob('img1', new Blob(['1']))
    await storage.putImageBlob('img2', new Blob(['2']))

    await sync(storage, cloud, alwaysConfirm)

    // 云端图片集合经 listImages 断言（CloudAdapter 无 getImage——图片显示
    // 走签名 URL，见 cloud.type.ts 注释）：只出现被引用且暂存存在的 img1。
    expect(await cloud.listImages()).toEqual(['img1'])
    // 上传成功后本地暂存删除（存在即待上传的推断不失真）。
    expect(await storage.getImageBlob('img1')).toBeUndefined()
  })
})

describe('sync：上传提交点幂等（manifest 失败自愈）', () => {
  it('manifest 提交失败 → 抛错且 dirty 保持；重试成功', async () => {
    // manifest 是上传提交点：分片已写但 manifest 失败时不能清除 dirty；
    // 下一次重试应安全覆盖同一分片并最终提交，避免形成无法恢复的半成功状态。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(recordFixture('a', '2026-08-02T10:00:00+08:00'))
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 5,
      dirty: true,
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: { '2026-08': 5 } })

    // 第一次：manifest 提交失败。
    cloud.failPutManifest = true
    await expect(sync(storage, cloud, alwaysConfirm)).rejects.toThrow()
    // 本地 dirty 未复位（等待重试）。
    expect((await storage.getPartitionState('2026-08'))?.dirty).toBe(true)
    // 月份文件已写入（幂等，重试会覆盖）。
    expect((await cloud.getPartitionFile('2026-08'))?.revision).toBe(6)

    // 重试：成功。
    cloud.failPutManifest = false
    const result = await sync(storage, cloud, alwaysConfirm)
    expect(result.outcome).toBe('uploaded')
    expect((await cloud.getManifest())?.partitions['2026-08']).toBe(6)
    expect((await storage.getPartitionState('2026-08'))?.dirty).toBe(false)
  })
})

describe('sync：类型模板作为独立全局集合同步', () => {
  it('本地模板 dirty 且云端版本一致 → 上传模板文件并复位全局状态', async () => {
    // 模板不是某个月份记录的附属数据：即使没有任何记录分片 dirty，模板
    // 也必须独立触发上传，并在同一个 manifest 提交点后复位本地状态。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putTypeTemplateAndMarkDirty({
      type: '记账',
      icon: 'wallet',
      attributes: [{ name: '费用', kind: 'number' }],
    })
    await cloud.putManifest({ schemaVersion: 1, typeTemplatesRevision: 0, partitions: {} })

    const result = await sync(storage, cloud, alwaysConfirm)

    expect(result.outcome).toBe('uploaded')
    expect(await cloud.getTypeTemplatesFile()).toEqual({
      revision: 1,
      templates: [{ type: '记账', icon: 'wallet', attributes: [{ name: '费用', kind: 'number' }] }],
    })
    expect((await cloud.getManifest())?.typeTemplatesRevision).toBe(1)
    expect(await storage.getTypeTemplateState()).toEqual({
      remoteRevision: 1,
      dirty: false,
    })
  })

  it('云端模板版本更高且本地不 dirty → 下载并替换本地模板集合', async () => {
    // 云端模板是全局集合，下载必须清掉本地已经不存在于云端的模板，且
    // revision/dirty 与集合一起更新，避免下一次检查重复下载。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putTypeTemplateAndMarkDirty({ type: '旧模板', icon: 'library', attributes: [] })
    await storage.putTypeTemplateState({ remoteRevision: 1, dirty: false })
    await cloud.putManifest({
      schemaVersion: 1,
      partitions: {},
      typeTemplatesRevision: 2,
    })
    await cloud.putTypeTemplatesFile({
      revision: 2,
      templates: [{ type: '新模板', icon: 'wallet', attributes: [{ name: '费用', kind: 'number' }] }],
    })

    const result = await sync(storage, cloud, alwaysConfirm)

    expect(result.outcome).toBe('downloaded')
    expect(await storage.getTypeTemplates()).toEqual([
      { type: '新模板', icon: 'wallet', attributes: [{ name: '费用', kind: 'number' }] },
    ])
    expect(await storage.getTypeTemplateState()).toEqual({
      remoteRevision: 2,
      dirty: false,
    })
  })

  it('云端模板文件 revision 与 manifest 不一致 → 保留本地模板并报告损坏', async () => {
    // 模板文件和 manifest 必须属于同一次提交；即使文件结构本身合法，
    // 版本错配也不能替换本地模板，否则表单规则可能回到未提交的快照。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putTypeTemplateAndMarkDirty({
      type: '本地模板',
      icon: 'library',
      attributes: [],
    })
    await storage.putTypeTemplateState({ remoteRevision: 1, dirty: false })
    await cloud.putManifest({
      schemaVersion: 1,
      partitions: {},
      typeTemplatesRevision: 2,
    })
    await cloud.putTypeTemplatesFile({
      revision: 3,
      templates: [{ type: '意外模板', icon: 'wallet', attributes: [] }],
    })

    const result = await sync(storage, cloud, alwaysConfirm)

    expect(result.outcome).toBe('already-latest')
    expect(result.brokenTypeTemplates).toBe(true)
    expect(await storage.getTypeTemplates()).toEqual([
      { type: '本地模板', icon: 'library', attributes: [] },
    ])
    expect(await storage.getTypeTemplateState()).toEqual({
      remoteRevision: 1,
      dirty: false,
    })
  })

  it('模板冲突取消时整体中止，不覆盖本地模板', async () => {
    // 全局模板与记录月份一样遵守云端优先但必须先确认；用户取消时不能
    // 只下载模板或只改同步状态，整个同步操作保持零变更。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.putTypeTemplateAndMarkDirty({ type: '本地模板', icon: 'library', attributes: [] })
    await storage.putTypeTemplateState({ remoteRevision: 1, dirty: true })
    await cloud.putManifest({
      schemaVersion: 1,
      partitions: {},
      typeTemplatesRevision: 2,
    })
    await cloud.putTypeTemplatesFile({
      revision: 2,
      templates: [{ type: '云端模板', icon: 'book-open', attributes: [] }],
    })

    const result = await sync(storage, cloud, async (_months, templateConflict) => {
      expect(templateConflict).toBe(true)
      return false
    })

    expect(result.outcome).toBe('aborted')
    expect(await storage.getTypeTemplates()).toEqual([
      { type: '本地模板', icon: 'library', attributes: [] },
    ])
    expect(await storage.getTypeTemplateState()).toEqual({
      remoteRevision: 1,
      dirty: true,
    })
  })
})
