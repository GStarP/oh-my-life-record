import { Capacitor } from '@capacitor/core'
import { nativeData } from '../../storage/native'
import type { StorageAdapter, ImageFile } from '../../storage/type'
import type { DraftImage } from './image-import.type'
import type { ImageStore } from './files.type'

export function createImageStore(storage: StorageAdapter): ImageStore {
  return {
    async persist(image: DraftImage): Promise<ImageFile> {
      const file = await nativeData.writeImage({ id: image.id, token: image.token })
      return { ...file, id: image.id }
    },
    async remove(images) {
      if (images.length) await nativeData.removeFiles({ paths: images.map((image) => image.path) })
    },
    async source(id, thumbnail) {
      const file = await storage.getImage(id)
      if (!file) throw new Error('图片引用不存在')
      const result = await nativeData.imageSource({ path: file.path, thumbnail })
      return Capacitor.convertFileSrc(result.uri)
    },
  }
}
