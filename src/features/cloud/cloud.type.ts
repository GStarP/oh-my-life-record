/**
 * CloudAdapter：同步引擎访问云端的唯一接口（Cloudflare R2，见 ADR-0001）。
 *
 * 真实实现用本地 SigV4 签名访问 R2；内存测试替身（tests/helpers）供同步引擎
 * 单元测试使用。接口同样由「同步引擎需要什么」决定。
 */
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
  // 注意：没有 getImage——图片展示一律走签名 GET URL（getSignedGetUrl，
  // 见 docs/设计文档.md §6.2）；「图片清理」只扫描 listImages。
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
