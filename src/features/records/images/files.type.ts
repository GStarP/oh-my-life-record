import type { ImageFile } from '../../storage/type'
import type { DraftImage } from './image-import.type'
export interface ImageStore {
  persist(image: DraftImage): Promise<ImageFile>
  remove(images: ImageFile[]): Promise<void>
  source(id: string, thumbnail: boolean): Promise<string>
}

