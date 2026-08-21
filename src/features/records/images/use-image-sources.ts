/** ImageManager 的 React 适配器；资源获取与释放仍由非 React module 完成。 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { credentialAtom } from '../../cloud/state'
import { cloudResourceNamespace } from '../../cloud/credential/credential'
import type { StagedImagePreview } from './image-staging.type'
import type {
  ImageDisplaySource,
  ImageManager,
  ImageManagerLease,
} from './image-manager.type'

export function useImageSources(
  imageManager: ImageManager,
  imageIds: string[],
  enabled = true,
): {
  sources: Record<string, ImageDisplaySource>
  addStagedImages: (images: StagedImagePreview[]) => void
  invalidateImage: (imageId: string) => void
} {
  // 记录页和编辑器会被 keep-alive；凭证变化时必须主动重建租约，
  // 让同一 imageId 重新落到新的 endpoint/bucket 命名空间。
  const credential = useAtomValue(credentialAtom)
  const imageNamespace = cloudResourceNamespace(credential)
  const [sources, setSources] = useState<Record<string, ImageDisplaySource>>({})
  const leaseRef = useRef<ImageManagerLease | undefined>(undefined)

  useEffect(() => {
    if (!enabled) {
      setSources({})
      return
    }
    const lease = imageManager.createLease(setSources)
    leaseRef.current = lease
    return () => {
      lease.release()
      if (leaseRef.current === lease) leaseRef.current = undefined
      setSources({})
    }
  }, [enabled, imageManager, imageNamespace])

  useEffect(() => {
    if (enabled) leaseRef.current?.setImageIds(imageIds)
  }, [enabled, imageIds, imageManager, imageNamespace])

  const addStagedImages = useCallback((images: StagedImagePreview[]) => {
    leaseRef.current?.addStagedImages(images)
  }, [])

  const invalidateImage = useCallback((imageId: string) => {
    leaseRef.current?.invalidateImage(imageId)
  }, [])

  return { sources, addStagedImages, invalidateImage }
}
