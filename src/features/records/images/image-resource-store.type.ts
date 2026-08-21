/** 记录页图片资源 module 的非 React interface。 */
import type { ImageSource } from './image-pipeline.type'
import type { StagedImagePreview } from './image-staging.type'

export type ImageResourceChangeHandler = (
  sources: Record<string, ImageSource>,
) => void

export type ImageResourceEntry = {
  id: string
  source?: ImageSource
  loading?: Promise<ImageSource>
  references: number
  lastUsed: number
}

export type ImageResourceLeaseState = {
  ids: Set<string>
  onChange: ImageResourceChangeHandler
  released: boolean
}

/** 一个可见使用者对图片集合的租约；租约结束后资源才可能被 LRU 淘汰。 */
export type ImageResourceLease = {
  setImageIds(imageIds: string[]): void
  addStagedImages(images: StagedImagePreview[]): void
  invalidateImage(imageId: string): void
  release(): void
}

export type ImageResourceStoreOptions = {
  /** 内存缓存上限，按压缩后图片 Blob 大小估算。 */
  maxBytes?: number
}

export type ImageResourceStore = {
  createLease(onChange: ImageResourceChangeHandler): ImageResourceLease
  dispose(): void
}
