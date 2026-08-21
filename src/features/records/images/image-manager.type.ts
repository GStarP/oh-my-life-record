/** 图片管理 module 的公共 interface；调用方不需要知道图片的存储来源。 */
import type { CloudAdapter } from '../../cloud/cloud.type'
import type { StorageAdapter } from '../../storage/type'
import type { StagedImagePreview } from './image-staging.type'

export type ImageDisplaySource =
  | { kind: 'ready'; url: string }
  | { kind: 'error' }

export type ImageManagerChangeHandler = (
  sources: Record<string, ImageDisplaySource>,
) => void

export type ImageManagerLease = {
  /** 设置当前显示位置使用的图片 ID；重复 ID 只会保留一份资源。 */
  setImageIds(imageIds: string[]): void
  /** 将新暂存的图片预览交给 manager，并加入当前显示位置。 */
  addStagedImages(images: StagedImagePreview[]): void
  /** 当前显示位置的图片加载失败时通知 manager。 */
  invalidateImage(imageId: string): void
  /** 当前显示位置不再使用这些图片。 */
  release(): void
}

export type ImageManager = {
  createLease(onChange: ImageManagerChangeHandler): ImageManagerLease
}

export type ImageManagerOptions = {
  storage: StorageAdapter
  getCloud: () => CloudAdapter | undefined
  /** 返回当前云端身份；变化时同一 imageId 必须进入新的内存缓存命名空间。 */
  getImageNamespace?: () => string
  /** 页面内存缓存的压缩后 Blob 容量上限。 */
  maxMemoryBytes?: number
}
