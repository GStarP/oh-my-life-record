/**
 * 清理云端图片编排契约测试（InMemory 替身）。
 *
 * 为什么测：这是唯一会**删除云端对象**的功能（docs/设计文档.md §9）——
 * 编排错了（把被引用的图删了）就是不可恢复的数据丢失，必须锁住
 * 「只删无引用孤儿」这一核心不变量。
 */
import { describe, expect, it } from 'vitest'
import { cleanupCloudImages } from '../src/features/cloud/cleanup'
import { InMemoryStorage } from './helpers/inmemory.storage'
import { InMemoryCloud } from './helpers/inmemory.cloud'
import type { LifeRecord } from '../src/features/records/type'

function rec(id: string, images: string[]): LifeRecord {
  return { id, time: new Date('2026-08-01T10:00:00+08:00'), type: '测试', name: '', description: '', images, attributes: {} }
}

describe('cleanupCloudImages：只删无引用孤儿', () => {
  it('删除未被任何记录引用的云端图片，保留被引用的', async () => {
    // img1：被本地记录引用 → 必须保留；img2/img3：无引用 → 删除。
    // 这是「清理」的唯一正确语义：任何被引用图片的误删都是数据丢失。
    const storage = new InMemoryStorage()
    const cloud = new InMemoryCloud()
    await storage.upsertRecord(rec('a', ['img1']))
    await cloud.putImage('img1', new Blob(['1']))
    await cloud.putImage('img2', new Blob(['2']))
    await cloud.putImage('img3', new Blob(['3']))

    const deleted = await cleanupCloudImages(storage, cloud)

    expect(deleted).toBe(2)
    expect(await cloud.listImages()).toEqual(['img1'])
  })
})
