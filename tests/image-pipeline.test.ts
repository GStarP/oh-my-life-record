/** 图片来源解析与本地暂存清理测试。 */
import { describe, expect, it, vi } from 'vitest'
import { clearImageCache, loadImageSource } from '../src/features/records/images/image-pipeline'
import { cleanupLocalOrphanImages } from '../src/features/records/images/image-staging'
import { InMemoryStorage } from './helpers/inmemory.storage'
import { InMemoryCloud } from './helpers/inmemory.cloud'
import type { LifeRecord } from '../src/features/records/type'

const DAY_MS = 24 * 60 * 60 * 1000

function recordWithImages(id: string, images: string[]): LifeRecord {
  return {
    id,
    time: new Date('2026-08-16T10:00:00+08:00'),
    type: '测试',
    name: '',
    description: '',
    images,
    attributes: {},
  }
}

describe('cleanupLocalOrphanImages：本地图片暂存清理', () => {
  it('立即清理无记录引用的图片，但保留仍被记录引用的图片', async () => {
    // 新建表单放弃、移除图片或删除记录后必须立即释放本地暂存；
    // 但同一张图片仍被其他记录引用时不能误删，否则后续同步会缺图。
    const storage = new InMemoryStorage()
    await storage.upsertRecord(recordWithImages('record-1', ['used']))
    await storage.putImageBlob('used', new Blob(['used']))
    await storage.putImageBlob('orphan', new Blob(['orphan']))

    await expect(
      cleanupLocalOrphanImages(storage, Date.now(), 0),
    ).resolves.toBe(1)
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

  it('云端图片复用稳定缓存；清空图片缓存后重新下载，不影响应用缓存', async () => {
    // presigned URL 的签名查询参数每次都会变化，不能直接依赖普通 HTTP URL 缓存；
    // 图片管线必须用不含签名参数的稳定对象路径作为 Cache Storage key，
    // 这样第二次加载无需再次下载图片，同时仍不把已上传图片写入 IndexedDB。
    // 本机清空只应删除图片缓存，不能误删应用静态缓存；清空后相同图片必须重新下载。
    const entries = new Map<string, Response>()
    const cacheNames = new Set(['omlr-images-v1', 'app-shell'])
    const keyOf = (request: RequestInfo | URL) =>
      request instanceof Request ? request.url : String(request)
    const cache = {
      match: async (request: RequestInfo | URL) =>
        entries.get(keyOf(request))?.clone(),
      put: async (request: RequestInfo | URL, response: Response) => {
        entries.set(keyOf(request), response.clone())
      },
    } as unknown as Cache
    const cacheStorage = {
      open: async () => cache,
      delete: async (name: string) => {
        if (name === 'omlr-images-v1') entries.clear()
        return cacheNames.delete(name)
      },
    } as unknown as CacheStorage
    const cachesDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches')
    const originalFetch = globalThis.fetch
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:omlr-cache-test')
    const fetchMock = vi.fn(async () =>
      new Response(new Blob(['image bytes'], { type: 'image/webp' }), {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      }),
    )

    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      writable: true,
      value: cacheStorage,
    })
    globalThis.fetch = fetchMock as typeof fetch

    try {
      const cloud = new InMemoryCloud()
      const first = await loadImageSource(
        new InMemoryStorage(),
        cloud,
        'image-1',
      )
      const second = await loadImageSource(
        new InMemoryStorage(),
        cloud,
        'image-1',
      )

      expect(first.kind).toBe('ready')
      expect(second.kind).toBe('ready')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(entries.size).toBe(1)

      await clearImageCache()
      expect(entries.size).toBe(0)
      expect(cacheNames).toEqual(new Set(['app-shell']))
      await loadImageSource(new InMemoryStorage(), cloud, 'image-1')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      createObjectUrl.mockRestore()
      globalThis.fetch = originalFetch
      if (cachesDescriptor) {
        Object.defineProperty(globalThis, 'caches', cachesDescriptor)
      } else {
        Reflect.deleteProperty(globalThis, 'caches')
      }
    }
  })
})
