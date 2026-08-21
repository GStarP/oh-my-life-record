/** 记录写操作的公开契约：原子标脏、跨月语义与图片清理。 */
import { describe, expect, it } from 'vitest'
import { createRecordWorkflow } from '../src/features/records/record-workflow'
import { InMemoryStorage } from './helpers/inmemory.storage'
import { recordFixture } from './helpers/record'

describe('RecordWorkflow：记录写入与图片暂存清理', () => {
  it('保存记录时标记所属月份，并正确收敛暂存图片', async () => {
    // 保存必须同时完成三件事：写入记录、保留远端 revision 并标 dirty、
    // 保留记录引用的图片且清除本次表单放弃的图片。
    const storage = new InMemoryStorage()
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 7,
      dirty: false,
    })
    const referencedImage = new Blob(['referenced'])
    const orphanImage = new Blob(['orphan'])
    await storage.putImageBlob('image-used', referencedImage)
    await storage.putImageBlob('image-orphan', orphanImage)
    const workflow = createRecordWorkflow({ storage })

    const record = recordFixture('record-1', '2026-08-19T10:00:00+08:00', {
      images: ['image-used'],
    })
    await workflow.save(record, undefined)

    await expect(storage.getRecordsInMonth('2026-08')).resolves.toEqual([record])
    await expect(storage.getPartitionState('2026-08')).resolves.toEqual({
      month: '2026-08',
      remoteRevision: 7,
      dirty: true,
    })
    await expect(storage.getImageBlob('image-used')).resolves.toBe(referencedImage)
    await expect(storage.getImageBlob('image-orphan')).resolves.toBeUndefined()
  })

  it('编辑跨月时同时标记旧月与新月', async () => {
    // 跨月编辑在云端表现为“旧月移除 + 新月写入”；两个分片都必须 dirty，
    // 否则旧月份会永久残留修改前的记录。
    const storage = new InMemoryStorage()
    const previous = recordFixture('move', '2026-07-31T15:59:59.000Z')
    const updated = { ...previous, time: new Date('2026-08-01T16:00:00.000Z') }
    await storage.upsertRecord(previous)
    await storage.putPartitionState({
      month: '2026-07',
      remoteRevision: 2,
      dirty: false,
    })
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 4,
      dirty: false,
    })

    await createRecordWorkflow({ storage }).save(updated, previous.time)

    await expect(storage.getRecordsInMonth('2026-07')).resolves.toEqual([])
    await expect(storage.getRecordsInMonth('2026-08')).resolves.toEqual([updated])
    expect((await storage.getPartitionState('2026-07'))?.dirty).toBe(true)
    expect((await storage.getPartitionState('2026-08'))?.dirty).toBe(true)
  })

  it('删除记录时标记原月份并清理失去引用的暂存图片', async () => {
    // 即使删除的是月份中最后一条记录，也必须把原月份标 dirty 以便上传空分片；
    // 删除后失去引用的本地暂存图片应随即清理。
    const storage = new InMemoryStorage()
    const image = new Blob(['only-reference'])
    await storage.putImageBlob('image-only', image)
    const record = recordFixture('record-1', '2026-08-19T10:00:00+08:00', {
      images: ['image-only'],
    })
    await storage.upsertRecord(record)
    await storage.putPartitionState({
      month: '2026-08',
      remoteRevision: 3,
      dirty: false,
    })
    const workflow = createRecordWorkflow({ storage })

    await workflow.delete(record)

    await expect(storage.getRecordsInMonth('2026-08')).resolves.toEqual([])
    await expect(storage.getPartitionState('2026-08')).resolves.toEqual({
      month: '2026-08',
      remoteRevision: 3,
      dirty: true,
    })
    await expect(storage.getImageBlob('image-only')).resolves.toBeUndefined()
  })
})
