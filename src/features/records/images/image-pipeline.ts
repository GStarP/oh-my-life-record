/** 图片显示来源解析与 Object URL 释放；缓存读写由 image-cache 负责。 */
import type { CloudAdapter } from '../../cloud/cloud.type'
import type { StorageAdapter } from '../../storage/type'
import type { ImageSource } from './image-pipeline.type'
import { cloudRequest } from '../../cloud/request'
import { loadCachedImageBlob } from './image-cache'

async function loadCloudImage(signedUrl: string): Promise<ImageSource> {
  try {
    const blob = await loadCachedImageBlob(signedUrl, () =>
      cloudRequest(async (signal) => {
        const response = await fetch(signedUrl, { cache: 'default', signal })
        if (!response.ok) throw new Error('图片读取失败（HTTP ' + response.status + '）')
        return response.blob()
      }),
    )
    return {
      kind: 'ready',
      url: URL.createObjectURL(blob),
      ownsUrl: true,
      size: blob.size,
    }
  } catch (error) {
    // fetch 可能因为 R2 CORS 不允许读取响应而失败；<img> 仍可直接加载签名 URL。
    if (error instanceof TypeError && typeof navigator !== 'undefined' && navigator.onLine) {
      return { kind: 'ready', url: signedUrl, ownsUrl: false }
    }
    return { kind: 'error' }
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
    return loadCloudImage(await cloudRequest(() => cloud.getSignedGetUrl(imageId)))
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
