/** 本地图片暂存的孤儿清理契约。 */
import { describe, expect, it } from 'vitest'
import { cleanupLocalOrphanImages } from '../src/features/records/images/image-staging'
import { InMemoryStorage } from './helpers/inmemory.storage'
import { recordFixture } from './helpers/record'

const DAY_MS = 24 * 60 * 60 * 1000

describe('cleanupLocalOrphanImages：本地图片暂存清理', () => {
  it('立即清理无记录引用的图片，但保留仍被记录引用的图片', async () => {
    // 新建表单放弃、移除图片或删除记录后必须立即释放本地暂存；
    // 但同一张图片仍被其他记录引用时不能误删，否则后续同步会缺图。
    const storage = new InMemoryStorage()
    await storage.upsertRecord(recordFixture('record-1', '2026-08-16T10:00:00+08:00', {
      images: ['used'],
    }))
    await storage.putImageBlob('used', new Blob(['used']))
    await storage.putImageBlob('orphan', new Blob(['orphan']))

    await expect(cleanupLocalOrphanImages(storage, Date.now(), 0)).resolves.toBe(1)
    expect(await storage.getImageBlob('used')).toBeDefined()
    expect(await storage.getImageBlob('orphan')).toBeUndefined()
  })

  it('启动兜底只清理超过七天的孤儿，较新的孤儿留待下一次启动', async () => {
    // 启动清理不能因为一次异常退出就删除用户刚刚选中的图片；
    // 默认七天门槛给短暂中断留下恢复机会，同时仍能收回长期遗留的 Blob。
    const storage = new InMemoryStorage()
    const now = Date.parse('2026-08-16T00:00:00Z')
    await storage.putImageBlob('old-orphan', new Blob(['old']), now - 8 * DAY_MS)
    await storage.putImageBlob('recent-orphan', new Blob(['recent']), now - DAY_MS)

    await expect(cleanupLocalOrphanImages(storage, now)).resolves.toBe(1)
    expect(await storage.getImageBlob('old-orphan')).toBeUndefined()
    expect(await storage.getImageBlob('recent-orphan')).toBeDefined()
  })
})
