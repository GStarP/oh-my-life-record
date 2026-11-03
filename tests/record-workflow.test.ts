import { expect, it } from 'vitest'
import { createRecordWorkflow } from '../src/features/records/record-workflow'
import type { ImageStore } from '../src/features/records/images/files.type'
import type { ImageFile } from '../src/features/storage/type'
import { createTestStorage } from './helpers/sqlite'
import { recordFixture } from './helpers/record'

it('文件写入或引用事务失败时回收本次文件、保留草稿，并允许完整重试', async () => {
  // 文件与 SQLite 不共享事务：中途失败必须回收已写文件，且不能改动原有记录或修改序号。
  // 同一份草稿引用接着重试必须成功；测试分别制造磁盘阶段和外键事务阶段的失败。
  const { storage, database } = createTestStorage()
  const files = new Map<string, ImageFile>()
  let failWrite = true
  const images: ImageStore = {
    async persist(draft) {
      if (failWrite && draft.id === 'b') throw new Error('磁盘写入失败')
      const image = { id: draft.id, path: 'images/' + draft.id + '.webp', mime: 'image/webp', bytes: 1, sha256: draft.id.repeat(64) }
      files.set(image.id, image); return image
    },
    async remove(removed) { removed.forEach((image) => files.delete(image.id)) },
    async source(id) { return 'file:///images/' + id },
  }
  const workflow = createRecordWorkflow({ storage, images })
  const drafts = ['a', 'b'].map((id) => ({ id, token: id, url: 'content://draft/' + id, previewUrl: 'content://draft/' + id + '/preview' }))
  try {
    await storage.saveRecord(recordFixture('baseline', '2026-10-01T00:00:00Z'))
    const before = await storage.inspect()
    const record = recordFixture('new', '2026-10-02T00:00:00Z', { images: ['a', 'b'] })
    await expect(workflow.save(record, drafts)).rejects.toThrow('磁盘')
    expect(files.size).toBe(0)
    expect((await storage.inspect()).sequence).toBe(before.sequence)
    failWrite = false
    await expect(workflow.save({ ...record, images: ['a', 'b', 'missing'] }, drafts)).rejects.toThrow()
    expect(files.size).toBe(0)
    expect((await storage.queryRecords()).records.map((item) => item.id)).toEqual(['baseline'])
    expect(drafts.map((draft) => draft.token)).toEqual(['a', 'b'])
    await workflow.save(record, drafts)
    expect(files.size).toBe(2)
    expect((await storage.inspect()).images).toHaveLength(2)
  } finally { database.close() }
})
