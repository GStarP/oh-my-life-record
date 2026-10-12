/** 云端快照与图片的读写接口；由 R2 实现和内存测试替身共同使用。 */
import type { Manifest, PartitionFile } from './sync/engine.type'
import type { TypeTemplatesFile } from '../type-templates/type'

/** 当前云端端口的 R2 连接配置；只代表可发起请求的完整配置。 */
export type R2Config = {
  endpoint: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
}

export interface CloudAdapter {
  /** 清空本应用的云端对象，保留桶与无关对象；失败可能已部分删除，可重试。 */
  clearAllData(): Promise<void>

  // ---- manifest ----
  getManifest(): Promise<Manifest | undefined>
  putManifest(manifest: Manifest): Promise<void>

  // ---- 分片文件 ----
  /** 读取某分片文件；不存在（该月从未上传）返回 undefined。 */
  getPartitionFile(month: string): Promise<PartitionFile | undefined>
  putPartitionFile(file: PartitionFile): Promise<void>

  // ---- 类型模板文件 ----
  /** 读取全局类型模板文件；从未上传时返回 undefined。 */
  getTypeTemplatesFile(): Promise<TypeTemplatesFile | undefined>
  /** 写入全局类型模板文件。 */
  putTypeTemplatesFile(file: TypeTemplatesFile): Promise<void>

  // ---- 图片对象 ----
  // 已上传图片经 getSignedGetUrl 交给图片管线读取缓存或下载，无独立 getImage。
  putImage(imageId: string, blob: Blob): Promise<void>
  deleteImage(imageId: string): Promise<void>
  /** 列出云端全部图片对象 ID（「图片清理」功能用）。 */
  listImages(): Promise<string[]>

  /**
   * 生成短期有效的签名 GET URL（图片显示用，见 CONTEXT.md「本地签名 URL」）。
   * 异步：SigV4 签名依赖 WebCrypto（crypto.subtle），无法同步生成。
   */
  getSignedGetUrl(imageId: string): Promise<string>
}
