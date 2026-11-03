import { Capacitor } from '@capacitor/core'
import { ulid } from 'ulidx'
import { nativeData } from '../../storage/native'
import type { DraftImage } from './image-import.type'

/** 草稿只持有原生图片引用与按需生成的预览地址。 */
export async function pickImages(): Promise<DraftImage[]> {
  const { images } = await nativeData.pickImages()
  return images.map((image) => ({
    id: ulid(), token: image.token,
    url: Capacitor.convertFileSrc(image.uri),
    previewUrl: Capacitor.convertFileSrc(image.previewUri),
  }))
}

export function releaseImages(images: DraftImage[]): void {
  if (images.length) void nativeData.releaseImages({ tokens: images.map((image) => image.token) }).catch(() => {})
}
