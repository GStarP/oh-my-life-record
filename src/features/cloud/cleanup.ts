/**
 * 图片清理（docs/设计文档.md §9）：扫描本地全部记录 + 云端全部图片，
 * 删除无引用者（孤儿），确认后由设置页调用。
 *
 * 核心不变量：**只删未被任何记录引用的图片**——被引用图片的误删是不可恢复的
 * 数据丢失；引用集合按图片 ID 去重（同一图片可被多条记录共享）。
 */
import type { StorageAdapter } from '../storage/type'
import type { CloudAdapter } from './cloud.type'

/** 执行清理；返回删除的图片数量。 */
export async function cleanupCloudImages(
  storage: StorageAdapter,
  cloud: CloudAdapter,
): Promise<number> {
  const [cloudIds, records] = await Promise.all([
    cloud.listImages(),
    storage.getAllRecords(),
  ])
  const referenced = new Set(records.flatMap((r) => r.images))
  const orphans = cloudIds.filter((id) => !referenced.has(id))
  for (const id of orphans) {
    await cloud.deleteImage(id)
  }
  return orphans.length
}
