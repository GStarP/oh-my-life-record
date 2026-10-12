import { afterEach, describe, expect, it, vi } from 'vitest'
import { AwsClient } from 'aws4fetch'
import { R2CloudAdapter } from '../src/features/cloud/r2/r2'
import { clearImageCache } from '../src/features/records/images/image-cache'
import { createImageManager } from '../src/features/records/images/image-manager'
import type { ImageDisplaySource } from '../src/features/records/images/image-manager.type'
import { InMemoryCloud } from './helpers/inmemory.cloud'
import { InMemoryStorage } from './helpers/inmemory.storage'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function imageEnvironment() {
  const stored = new Map<string, Map<string, Response>>([
    ['app-shell', new Map([['/index.html', new Response('app')]])],
  ])
  const put = vi.fn(async () => {})
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      if (!stored.has(name)) stored.set(name, new Map())
      const entries = stored.get(name)!
      return {
        put: async (key: Request, response: Response) => {
          await put()
          entries.set(key.url, response.clone())
        },
        match: async (key: Request) => entries.get(key.url)?.clone(),
      }
    },
    delete: async (name: string) => stored.delete(name),
  })
  vi.stubGlobal('navigator', { onLine: false })
  const fetch = vi.fn(async () => new Response(new Blob(['image'], { type: 'image/webp' })))
  vi.stubGlobal('fetch', fetch)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached-image')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { stored, put, fetch, storage: new InMemoryStorage() }
}

describe('图片离线缓存', () => {
  it('重建 manager 复用缓存；缺图可重试；清空只影响图片缓存', async () => {
    // 关闭页面会丢失内存，签名 URL 也会变化，但曾下载的图片仍应命中缓存。
    // 未缓存图片离线只显示占位，恢复网络后可以主动重试；清空图片缓存后
    // 再次打开应重新下载，同时保留应用壳。通过 manager 检查可显示结果，
    // 不绑定图片缓存名称或来源解析的内部步骤。
    const { storage, fetch, stored } = imageEnvironment()
    const cloud = new InMemoryCloud()
    const options = { storage, getCloud: () => cloud }
    let first: Record<string, ImageDisplaySource> = {}
    const firstLease = createImageManager(options).createLease((sources) => { first = sources })
    firstLease.setImageIds(['cached'])
    await vi.waitFor(() => expect(first.cached?.kind).toBe('ready'), { interval: 1 })
    firstLease.release()

    fetch.mockRejectedValue(new TypeError('断网'))
    let reopened: Record<string, ImageDisplaySource> = {}
    const lease = createImageManager(options).createLease((sources) => { reopened = sources })
    lease.setImageIds(['cached'])
    await vi.waitFor(() => expect(reopened.cached?.kind).toBe('ready'), { interval: 1 })
    expect(fetch).toHaveBeenCalledTimes(1)

    lease.setImageIds(['cached', 'uncached'])
    await vi.waitFor(() => expect(reopened.uncached?.kind).toBe('error'), { interval: 1 })
    fetch.mockImplementation(async () => new Response(new Blob(['reconnected'], { type: 'image/webp' })))
    lease.retryImage('uncached')
    await vi.waitFor(() => expect(reopened.uncached?.kind).toBe('ready'), { interval: 1 })
    expect(reopened.cached?.kind).toBe('ready')
    lease.release()

    await clearImageCache()
    expect([...stored.keys()]).toEqual(['app-shell'])
    let cleared: Record<string, ImageDisplaySource> = {}
    const clearedLease = createImageManager(options).createLease((sources) => { cleared = sources })
    clearedLease.setImageIds(['cached'])
    await vi.waitFor(() => expect(cleared.cached?.kind).toBe('ready'), { interval: 1 })
    expect(fetch).toHaveBeenCalledTimes(4)
    clearedLease.release()
  })

  it('上传成功即尽力缓存现有 Blob；缓存写入失败不把上传变成失败', async () => {
    // 同步上传后会删除 IndexedDB 暂存，必须利用现有 Blob 改善刚上传图片的
    // 离线体验。Cache Storage 配额不足不能把已成功的 PUT 误报失败；该图
    // 随后离线确实不可用，不能因为上传成功就声称已缓存。
    const { storage, fetch, put } = imageEnvironment()
    const cloud = new R2CloudAdapter({
      endpoint: 'https://image-cache.r2.cloudflarestorage.com',
      bucket: 'test', accessKeyId: 'test', accessKeySecret: 'test',
    })
    vi.spyOn(AwsClient.prototype, 'fetch').mockResolvedValue(new Response(null))
    await cloud.putImage('uploaded', new Blob(['uploaded'], { type: 'image/webp' }))

    fetch.mockRejectedValue(new TypeError('断网'))
    let sources: Record<string, ImageDisplaySource> = {}
    const lease = createImageManager({ storage, getCloud: () => cloud })
      .createLease((next) => { sources = next })
    lease.setImageIds(['uploaded'])
    await vi.waitFor(() => expect(sources.uploaded?.kind).toBe('ready'), { interval: 1 })
    expect(fetch).not.toHaveBeenCalled()

    put.mockRejectedValue(new Error('缓存配额不足'))
    await expect(cloud.putImage('not-cached', new Blob(['new']))).resolves.toBeUndefined()
    lease.setImageIds(['uploaded', 'not-cached'])
    await vi.waitFor(() => expect(sources['not-cached']?.kind).toBe('error'), { interval: 1 })
    lease.release()
  })
})
