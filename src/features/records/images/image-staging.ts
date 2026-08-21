/** 图片选择、压缩、本地暂存和孤儿清理。 */

import { ulid } from 'ulidx'
import type { StorageAdapter } from '../../storage/type'
import type { DecodedImage, StagedImagePreview } from './image-staging.type'

const MAX_IMAGE_EDGE = 2048
const WEBP_QUALITY = 0.8
const LOCAL_ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // 某些浏览器没有 HEIC 的 createImageBitmap 解码器，继续尝试 <img>。
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('无法解码图片'))
      element.src = objectUrl
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

/** 压缩为最长边 2048、质量 0.8 的 WebP；浏览器无法解码/编码时保留原文件。 */
async function compressImage(file: File): Promise<Blob> {
  let decoded: DecodedImage | undefined
  try {
    decoded = await decodeImage(file)
    const scale = Math.min(
      1,
      MAX_IMAGE_EDGE / Math.max(decoded.width, decoded.height),
    )
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(decoded.source, 0, 0, width, height)
    const compressed = await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob ?? undefined),
        'image/webp',
        WEBP_QUALITY,
      )
    })
    return compressed ?? file
  } catch {
    // HEIC 等格式在当前浏览器不可解码时，按产品约定保留原始 Blob。
    return file
  } finally {
    decoded?.close()
  }
}

/** 压缩并暂存多张图片；中途失败会回收本次已经写入的暂存项。 */
export async function stageImageFiles(
  storage: StorageAdapter,
  files: File[],
): Promise<StagedImagePreview[]> {
  const staged: StagedImagePreview[] = []
  const storedIds: string[] = []
  try {
    for (const file of files) {
      const blob = await compressImage(file)
      const id = ulid()
      await storage.putImageBlob(id, blob)
      storedIds.push(id)
      staged.push({ id, blob })
    }
    return staged
  } catch (error) {
    // 原始失败继续交给表单提示；本 module 不创建显示用 Object URL。
    await Promise.all(
      storedIds.map((id) => storage.deleteImageBlob(id)),
    ).catch(() => {})
    throw error
  }
}

/** 清理本地图片暂存区中没有任何记录引用的图片。 */
export async function cleanupLocalOrphanImages(
  storage: StorageAdapter,
  now: number = Date.now(),
  minAgeMs: number = LOCAL_ORPHAN_MAX_AGE_MS,
): Promise<number> {
  const [records, stagedImages] = await Promise.all([
    storage.getAllRecords(),
    storage.getStagedImages(),
  ])
  const referenced = new Set(records.flatMap((record) => record.images))
  const orphans = stagedImages.filter(
    (image) =>
      !referenced.has(image.id) &&
      (minAgeMs === 0 || now - image.createdAt >= minAgeMs),
  )
  await Promise.all(orphans.map((image) => storage.deleteImageBlob(image.id)))
  return orphans.length
}
