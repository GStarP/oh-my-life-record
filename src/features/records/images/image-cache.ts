/** 已上传图片的持久缓存；独立于应用壳版本和页面内存缓存。 */
const IMAGE_CACHE_NAME = 'omlr-images-v1'

function imageCacheKey(objectUrl: string): Request | undefined {
  try {
    const url = new URL(objectUrl)
    // 签名会变化；保留端点、桶名和对象路径，避免跨桶命中。
    url.search = ''
    return new Request(url.toString())
  } catch {
    return undefined
  }
}

/** 缓存优先；未命中才下载。缓存不可用或写入失败不影响在线读取。 */
export async function loadCachedImageBlob(
  objectUrl: string,
  download: () => Promise<Blob>,
): Promise<Blob> {
  const key = imageCacheKey(objectUrl)
  let cache: Cache | undefined
  if (key && typeof caches !== 'undefined') {
    try {
      cache = await caches.open(IMAGE_CACHE_NAME)
      const cached = await cache.match(key)
      if (cached) return await cached.blob()
    } catch {
      cache = undefined
    }
  }

  const blob = await download()
  if (cache && key) await cache.put(key, new Response(blob)).catch(() => {})
  return blob
}

/** 上传后复用现有 Blob；缓存不可用或写入失败不改变上传结果。 */
export async function cacheImageBlob(objectUrl: string, blob: Blob): Promise<void> {
  const key = imageCacheKey(objectUrl)
  if (!key || typeof caches === 'undefined') return
  try {
    const cache = await caches.open(IMAGE_CACHE_NAME)
    await cache.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } }))
  } catch {
    // 浏览器可以拒绝或淘汰缓存，不能将尽力缓存当成持久保存保证。
  }
}

/** 只清理图片缓存；不影响应用壳。失败交给调用方报告。 */
export async function clearImageCache(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(IMAGE_CACHE_NAME)
}
