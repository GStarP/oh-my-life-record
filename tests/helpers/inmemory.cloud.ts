/**
 * InMemoryCloud：CloudAdapter 的内存实现（仅供测试）。
 */
import type { Manifest, PartitionFile } from '../../src/features/cloud/sync/engine.type'
import type { TypeTemplatesFile } from '../../src/features/type-templates/type'
import type { CloudAdapter } from '../../src/features/cloud/cloud.type'

export class InMemoryCloud implements CloudAdapter {
  private manifest: Manifest | undefined
  private partitions = new Map<string, PartitionFile>()
  private typeTemplates: TypeTemplatesFile | undefined
  private images = new Map<string, Blob>()
  private signedGetCount = 0

  /** 测试失败注入：为 true 时 putManifest 抛错（模拟 manifest 提交失败）。 */
  failPutManifest = false

  async clearAllData(): Promise<void> {
    this.partitions.clear()
    this.images.clear()
    this.typeTemplates = undefined
    this.manifest = undefined
  }

  async getManifest(): Promise<Manifest | undefined> {
    return this.manifest
  }

  async putManifest(manifest: Manifest): Promise<void> {
    if (this.failPutManifest) throw new Error('模拟 manifest 提交失败')
    this.manifest = structuredClone(manifest)
  }

  async getPartitionFile(month: string): Promise<PartitionFile | undefined> {
    return this.partitions.get(month)
  }

  async putPartitionFile(file: PartitionFile): Promise<void> {
    this.partitions.set(file.month, structuredClone(file))
  }

  async getTypeTemplatesFile(): Promise<TypeTemplatesFile | undefined> {
    return this.typeTemplates && structuredClone(this.typeTemplates)
  }

  async putTypeTemplatesFile(file: TypeTemplatesFile): Promise<void> {
    this.typeTemplates = structuredClone(file)
  }

  async putImage(imageId: string, blob: Blob): Promise<void> {
    this.images.set(imageId, blob)
  }

  async deleteImage(imageId: string): Promise<void> {
    this.images.delete(imageId)
  }

  async listImages(): Promise<string[]> {
    return [...this.images.keys()]
  }

  async getSignedGetUrl(imageId: string): Promise<string> {
    this.signedGetCount++
    return `https://signed.inmemory/${imageId}?n=${this.signedGetCount}`
  }
}
