/**
 * 图片管理 module 的公共入口；应用只在 runtime 中创建一个实例。
 *
 * 调用方只提供图片 ID 和显示位置的生命周期；IndexedDB、Cache Storage、R2、
 * presigned URL、Object URL 和 LRU 都隐藏在内部实现之后。
 */
import { loadImageSource } from './image-pipeline'
import { createImageResourceStore } from './image-resource-store'
import type { ImageSource } from './image-pipeline.type'
import type {
  ImageDisplaySource,
  ImageManager,
  ImageManagerChangeHandler,
  ImageManagerOptions,
} from './image-manager.type'

type ResourceKey = string

function makeResourceKey(namespace: string, imageId: string): ResourceKey {
  return JSON.stringify([namespace, imageId])
}

function parseResourceKey(value: ResourceKey): string | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      return parsed[1]
    }
  } catch {
    // Resource keys are internal; a malformed key should only disappear from
    // the public snapshot, not make the whole image manager fail.
  }
  return undefined
}

function toDisplaySources(
  sources: Record<string, ImageSource>,
): Record<string, ImageDisplaySource> {
  const displaySources: Record<string, ImageDisplaySource> = {}
  for (const [resourceKey, source] of Object.entries(sources)) {
    const imageId = parseResourceKey(resourceKey)
    if (!imageId) continue
    displaySources[imageId] =
      source.kind === 'ready'
        ? { kind: 'ready', url: source.url }
        : { kind: 'error' }
  }
  return displaySources
}

export function createImageManager({
  storage,
  getCloud,
  getImageNamespace = () => 'default',
  maxMemoryBytes,
}: ImageManagerOptions): ImageManager {
  const resources = createImageResourceStore(
    (resourceKey) => {
      const imageId = parseResourceKey(resourceKey)
      return imageId
        ? loadImageSource(storage, getCloud(), imageId)
        : Promise.resolve({ kind: 'error' as const })
    },
    { maxBytes: maxMemoryBytes },
  )

  return {
    createLease(onChange: ImageManagerChangeHandler) {
      const lease = resources.createLease((sources) =>
        onChange(toDisplaySources(sources)),
      )
      const resourceKey = (imageId: string) =>
        makeResourceKey(getImageNamespace(), imageId)
      return {
        setImageIds(imageIds) {
          lease.setImageIds(imageIds.map(resourceKey))
        },
        addStagedImages(images) {
          lease.addStagedImages(
            images.map((image) => ({
              ...image,
              id: resourceKey(image.id),
            })),
          )
        },
        invalidateImage(imageId) {
          lease.invalidateImage(resourceKey(imageId))
        },
        release: lease.release,
      }
    },
  }
}
