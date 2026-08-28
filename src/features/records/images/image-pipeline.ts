/**
 * 图片显示来源解析：本地 IndexedDB、Cache Storage 和云端 presigned URL。
 *
 * 这里不依赖 React；ImageManager 只消费这个 module 的来源加载和释放接口，
 * 避免把 Blob、Cache Storage 与签名 URL 的生命周期散落到多个组件中。
 */
import type { CloudAdapter } from '../../cloud/cloud.type'
import type { StorageAdapter } from '../../storage/type'
import type { ImageSource } from './image-pipeline.type'

const IMAGE_CACHE_NAME = 'omlr-images-v1'

/** 只清理记录图片缓存，不清除应用静态资源或浏览器其他缓存。失败交给调用方报告。 */
export async function clearImageCache(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(IMAGE_CACHE_NAME)
}

function cacheKeyForSignedUrl(signedUrl: string): Request | undefined {
  try {
    const url = new URL(signedUrl)
    // 签名查询参数每次都会变化；用稳定的对象路径作为 Cache Storage key，
    // 同时保留 endpoint 和 bucket，避免测试桶与生产桶互相命中。
    url.search = ''
    return new Request(url.toString())
  } catch {
    return undefined
  }
}

/**
 * 从浏览器 Cache Storage 加载云端图片；缓存不可用时退回签名 URL。
 * Cache Storage 是浏览器可淘汰的缓存，不进入 IndexedDB，也不影响「云端图片
 * 不作为本地业务数据长期保存」的约束。图片 ID 不可变，因此缓存无需主动更新。
 */
async function loadCloudImage(signedUrl: string): Promise<ImageSource> {
  const cacheKey = cacheKeyForSignedUrl(signedUrl)
  let cache: Cache | undefined

  if (cacheKey && typeof caches !== 'undefined') {
    try {
      cache = await caches.open(IMAGE_CACHE_NAME)
      const cached = await cache.match(cacheKey)
      if (cached) {
        const blob = await cached.blob()
        return {
          kind: 'ready',
          url: URL.createObjectURL(blob),
          ownsUrl: true,
          size: blob.size,
        }
      }
    } catch {
      // 私密浏览、旧浏览器或存储配额不足时不阻断图片展示。
      cache = undefined
    }
  }

  try {
    const response = await fetch(signedUrl, { cache: 'default' })
    if (!response.ok) {
      return { kind: 'ready', url: signedUrl, ownsUrl: false }
    }
    const cacheResponse = response.clone()
    const blob = await response.blob()
    if (cache && cacheKey) {
      await cache.put(cacheKey, cacheResponse).catch(() => {})
    }
    return {
      kind: 'ready',
      url: URL.createObjectURL(blob),
      ownsUrl: true,
      size: blob.size,
    }
  } catch {
    // fetch 可能因为 R2 CORS 不允许读取响应而失败；<img> 仍可直接加载签名 URL。
    return { kind: 'ready', url: signedUrl, ownsUrl: false }
  }
}

/** 本地暂存优先；没有本地 Blob 时读取浏览器缓存或生成云端短期签名 URL。 */
export async function loadImageSource(
  storage: StorageAdapter,
  cloud: CloudAdapter | undefined,
  imageId: string,
): Promise<ImageSource> {
  try {
    const localBlob = await storage.getImageBlob(imageId)
    if (localBlob) {
      return {
        kind: 'ready',
        url: URL.createObjectURL(localBlob),
        ownsUrl: true,
        size: localBlob.size,
      }
    }
    if (!cloud) return { kind: 'error' }
    return loadCloudImage(await cloud.getSignedGetUrl(imageId))
  } catch {
    // 单张图片失败只显示错误占位，不阻塞记录列表或编辑器打开。
    return { kind: 'error' }
  }
}

export function releaseImageSource(source: ImageSource | undefined): void {
  if (source?.kind === 'ready' && source.ownsUrl) {
    URL.revokeObjectURL(source.url)
  }
}
