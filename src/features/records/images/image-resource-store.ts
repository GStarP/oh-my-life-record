/**
 * 应用内图片资源 module：合并并发加载、共享可见资源，并以 LRU 限制内存缓存。
 *
 * 这个 module 不依赖 React。调用者通过 lease 表示一个当前显示图片的界面；
 * 只要仍有 lease 使用资源，资源就不会被 LRU 淘汰。无使用者的 ready Blob
 * 进入有上限的内存缓存，带签名参数的直链不进入空闲缓存。
 */
import { releaseImageSource } from './image-pipeline'
import type { ImageSource, ImageSourceLoader } from './image-pipeline.type'
import type { StagedImagePreview } from './image-staging.type'
import type {
  ImageResourceChangeHandler,
  ImageResourceEntry,
  ImageResourceLease,
  ImageResourceLeaseState,
  ImageResourceStore,
  ImageResourceStoreOptions,
} from './image-resource-store.type'

export const DEFAULT_IMAGE_MEMORY_CACHE_BYTES = 32 * 1024 * 1024
const UNKNOWN_IMAGE_SIZE_BYTES = 1024 * 1024

function uniqueIds(imageIds: string[]): string[] {
  return [...new Set(imageIds)]
}

function retainedBytes(source: ImageSource | undefined): number {
  if (source?.kind !== 'ready' || !source.ownsUrl) return 0
  return source.size ?? UNKNOWN_IMAGE_SIZE_BYTES
}

function canKeepIdle(source: ImageSource | undefined): boolean {
  return source?.kind === 'ready' && source.ownsUrl
}

export function createImageResourceStore(
  loader: ImageSourceLoader,
  options: ImageResourceStoreOptions = {},
): ImageResourceStore {
  const entries = new Map<string, ImageResourceEntry>()
  const leases = new Set<ImageResourceLeaseState>()
  const maxBytes = Math.max(
    0,
    options.maxBytes ?? DEFAULT_IMAGE_MEMORY_CACHE_BYTES,
  )
  let accessSequence = 0
  let disposed = false

  function touch(entry: ImageResourceEntry): void {
    entry.lastUsed = ++accessSequence
  }

  function snapshot(lease: ImageResourceLeaseState): Record<string, ImageSource> {
    const sources: Record<string, ImageSource> = {}
    for (const id of lease.ids) {
      const source = entries.get(id)?.source
      if (source) sources[id] = source
    }
    return sources
  }

  function notify(lease: ImageResourceLeaseState): void {
    if (!lease.released) lease.onChange(snapshot(lease))
  }

  function notifyImage(id: string): void {
    for (const lease of [...leases]) {
      if (lease.ids.has(id)) notify(lease)
    }
  }

  function removeEntry(id: string, entry: ImageResourceEntry): void {
    if (entries.get(id) !== entry) return
    entries.delete(id)
    releaseImageSource(entry.source)
  }

  function totalRetainedBytes(): number {
    let total = 0
    for (const entry of entries.values()) total += retainedBytes(entry.source)
    return total
  }

  function evictIdleEntries(): void {
    while (totalRetainedBytes() > maxBytes) {
      const candidate = [...entries.values()]
        .filter(
          (entry) =>
            entry.references === 0 && canKeepIdle(entry.source),
        )
        .sort((left, right) => left.lastUsed - right.lastUsed)[0]
      if (!candidate) return
      removeEntry(candidate.id, candidate)
    }
  }

  function startLoading(id: string, entry: ImageResourceEntry): void {
    try {
      entry.loading = loader(id).catch(() => ({ kind: 'error' as const }))
    } catch {
      entry.loading = Promise.resolve({ kind: 'error' as const })
    }

    void entry.loading.then((source) => {
      if (disposed || entries.get(id) !== entry) {
        releaseImageSource(source)
        return
      }
      entry.loading = undefined
      entry.source = source
      touch(entry)
      if (entry.references === 0 && !canKeepIdle(source)) {
        removeEntry(id, entry)
        return
      }
      notifyImage(id)
      evictIdleEntries()
    })
  }

  function ensureEntry(id: string): ImageResourceEntry {
    const current = entries.get(id)
    if (current) return current
    const entry: ImageResourceEntry = {
      id,
      references: 0,
      lastUsed: 0,
    }
    entries.set(id, entry)
    startLoading(id, entry)
    return entry
  }

  function retain(id: string): void {
    const entry = ensureEntry(id)
    entry.references += 1
    if (entry.source) touch(entry)
  }

  function release(id: string): void {
    const entry = entries.get(id)
    if (!entry) return
    entry.references = Math.max(0, entry.references - 1)
    if (entry.references === 0 && !entry.loading && !canKeepIdle(entry.source)) {
      removeEntry(id, entry)
      return
    }
    evictIdleEntries()
  }

  function updateLease(lease: ImageResourceLeaseState, imageIds: string[]): void {
    if (lease.released) return
    const nextIds = new Set(uniqueIds(imageIds))
    for (const id of lease.ids) {
      if (!nextIds.has(id)) release(id)
    }
    for (const id of nextIds) {
      if (!lease.ids.has(id)) retain(id)
    }
    lease.ids = nextIds
    notify(lease)
  }

  function installSources(images: StagedImagePreview[]): void {
    for (const image of images) {
      const current = entries.get(image.id)
      if (current?.references) {
        // 同一 ID 已经有可见使用者时，保留现有资源，避免替换掉其他界面正在使用的 URL。
        continue
      }
      if (current) {
        entries.delete(image.id)
        releaseImageSource(current.source)
      }
      entries.set(image.id, {
        id: image.id,
        source: {
          kind: 'ready',
          url: URL.createObjectURL(image.blob),
          ownsUrl: true,
          size: image.blob.size,
        },
        references: 0,
        lastUsed: ++accessSequence,
      })
    }
  }

  function createLease(onChange: ImageResourceChangeHandler): ImageResourceLease {
    const state: ImageResourceLeaseState = {
      ids: new Set(),
      onChange,
      released: disposed,
    }
    leases.add(state)

    return {
      setImageIds(imageIds) {
        updateLease(state, imageIds)
      },
      addStagedImages(images) {
        if (state.released) {
          return
        }
        installSources(images)
        updateLease(state, [
          ...state.ids,
          ...images.map((image) => image.id),
        ])
        evictIdleEntries()
      },
      invalidateImage(id) {
        if (state.released || !state.ids.has(id)) return
        const entry = entries.get(id)
        if (!entry || entry.source?.kind !== 'ready') return
        releaseImageSource(entry.source)
        entry.source = { kind: 'error' }
        touch(entry)
        notifyImage(id)
      },
      release() {
        if (state.released) return
        updateLease(state, [])
        state.released = true
        leases.delete(state)
      },
    }
  }

  return {
    createLease,
    dispose() {
      if (disposed) return
      disposed = true
      for (const lease of leases) {
        lease.released = true
        lease.ids.clear()
      }
      leases.clear()
      for (const entry of entries.values()) releaseImageSource(entry.source)
      entries.clear()
    },
  }
}
