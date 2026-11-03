import type { NativeFile } from '../storage/native.type'

export type R2Config = { endpoint: string; bucket: string; accessKeyId: string; accessKeySecret: string }
export type CloudSnapshot = { revision: number; sha256: string; bytes: number; etag: string }
export type CloudImage = { path: string; bytes: number }
export interface CloudAdapter {
  namespace: string
  getSnapshot(operationId?: string): Promise<CloudSnapshot | undefined>
  listImages(operationId?: string): Promise<CloudImage[]>
  uploadImage(path: string, mime: string, operationId: string): Promise<void>
  uploadSnapshot(file: NativeFile, revision: number, etag: string | undefined, operationId: string): Promise<void>
  download(key: string, destination: string, sha256: string, operationId: string, etag?: string): Promise<NativeFile>
  deleteImage(path: string, operationId: string): Promise<void>
}
