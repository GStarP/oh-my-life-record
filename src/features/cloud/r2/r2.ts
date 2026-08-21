/**
 * R2CloudAdapter：CloudAdapter 的 Cloudflare R2 真实实现。
 *
 * 访问方式：本地 SigV4 签名（aws4fetch），无签名服务（ADR-0001）。
 * 服务与区域由 aws4fetch 从端点主机名自动识别：
 * *.r2.cloudflarestorage.com → service s3、region auto。
 *
 * 云端对象布局（docs/cloud-storage-format.md）：
 *   manifest.json                清单（分片版本表）
 *   type-templates.json          全局类型模板集合
 *   records/YYYY-MM.json         分片（该月记录全集）
 *   images/{imageId}.webp        图片（不可变对象）
 *
 * 错误语义：
 * - 404（对象不存在）→ get* 返回 undefined（引擎按「云端无此月/无此图」处理）。
 * - 分片 JSON 损坏 → getPartitionFile 返回 undefined（引擎 brokenMonths：
 *   不覆盖本地、不中止同步；同步层会把该月份记录为损坏）；
 *   解码器一律抛错（具体原因在 Error 消息里），适配器在边界 catch 后
 *   记 console.warn 并翻译成 undefined。
 * - manifest JSON 损坏 → 抛错（manifest 驱动全部同步决策，静默当空
 *   可能导致错误上传覆盖云端）。解码器消息只报具体问题，
 *   「云端 manifest.json」前缀由 getManifest 捕获处统一添加。
 * - 网络/HTTP 错误（非 404）→ 抛 R2HttpError（中文消息 + HTTP status + R2 code，供凭证验证分类）。
 */
import { AwsClient } from 'aws4fetch'
import { CloudRequestError } from '../request-error'
import type { CloudAdapter, R2Config } from '../cloud.type'
import type { TypeTemplatesFile } from '../../type-templates/type'
import type { Manifest, PartitionFile } from '../sync/engine.type'
import {
  decodeManifest,
  decodePartitionFile,
  decodeTypeTemplatesFile,
  encodeManifest,
  encodePartitionFile,
  encodeTypeTemplatesFile,
} from './codec'

/** 签名 GET URL 的有效期（秒）。图片展示用：「短期」= 5 分钟（R2 默认 86400 太长）。 */
const SIGNED_URL_EXPIRES_SECONDS = 300

/**
 * R2 请求失败（非 404，或写路径 404）：携带 HTTP 状态码，
 * 供调用方分类处置（如凭证连接验证区分「凭证无效」与「云端/网络故障」，见 verify.ts）。
 */
export class R2HttpError extends CloudRequestError {
  constructor(
    message: string,
    readonly status: number,
    /** R2 错误码（响应体 XML 的 <Code>，如 NoSuchBucket / NoSuchKey / SignatureDoesNotMatch）；无法解析时为 undefined。 */
    readonly code: string | undefined = undefined,
  ) {
    super(message, status, code)
    this.name = 'R2HttpError'
  }
}
export class R2CloudAdapter implements CloudAdapter {
  private readonly client: AwsClient
  /** 桶根 URL：{endpoint}/{bucket}/（末尾带 /，便于 new URL(key, base)）。 */
  private readonly baseUrl: string

  constructor(config: R2Config) {
    // 配置正确性不在构造期校验：设置页保存时会先做真实连接验证，
    // 错误配置在首次请求时以签名或 HTTP 错误暴露。
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.accessKeySecret,
    })
    const base = new URL(config.endpoint)
    base.pathname = base.pathname.replace(/\/+$/, '') + '/' + config.bucket + '/'
    this.baseUrl = base.toString()
  }

  /** 图片对象键：images/{id}.webp。 */
  private imageKey(imageId: string): string {
    return 'images/' + encodeURIComponent(imageId) + '.webp'
  }

  /**
   * 统一签名请求。404 放行**仅限 GET**（调用方按「对象不存在」处理——
   * 读路径的「无此对象」是正常状态）；PUT/DELETE 的 404 一律视为错误
   * （如桶名写错时 R2 返回 NoSuchBucket——若静默放行，写入会被误报为
   * 成功，数据滞留本地且引擎照常置 dirty=false）。其余非 2xx 抛中文
   * 错误（含 R2 返回的响应体摘要，便于排查）。
   */
  private async signedRequest(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    body?: string | ArrayBuffer,
    contentType?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {}
    if (contentType) headers['Content-Type'] = contentType
    const res = await this.client.fetch(this.baseUrl + key, { method, headers, body })
    if (res.status === 404 && method === 'GET') return res
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const code = /<Code>([^<]+)<\/Code>/.exec(detail)?.[1]
      throw new R2HttpError(
        'R2 ' + method + ' ' + key + ' 失败（HTTP ' + res.status + '）：' + detail.slice(0, 200),
        res.status,
        code,
      )
    }
    return res
  }

  // ---- manifest ----
  async getManifest(): Promise<Manifest | undefined> {
    const res = await this.signedRequest('GET', 'manifest.json')
    if (res.status === 404) return undefined
    try {
      return decodeManifest(await res.text())
    } catch (err) {
      // 前缀统一在此添加：解码器只报具体问题
      throw new Error('云端 manifest.json：' + (err instanceof Error ? err.message : String(err)))
    }
  }

  async putManifest(manifest: Manifest): Promise<void> {
    await this.signedRequest('PUT', 'manifest.json', encodeManifest(manifest), 'application/json')
  }

  // ---- 分片文件 ----
  async getPartitionFile(month: string): Promise<PartitionFile | undefined> {
    const res = await this.signedRequest('GET', 'records/' + month + '.json')
    if (res.status === 404) return undefined
    let file: PartitionFile
    try {
      file = decodePartitionFile(await res.text())
    } catch (err) {
      // brokenMonths 语义：损坏不中止同步；具体原因仅作诊断输出
      console.warn('云端分片 ' + month + ' 损坏：' + (err instanceof Error ? err.message : String(err)))
      return undefined
    }
    // 业务校验：文件内容月份必须与请求一致（replacePartition 以 file.month
    // 为准，错配会替换错误分片）——解码器不掺业务判断，这里把关。
    if (file.month !== month) {
      console.warn('云端分片 ' + month + ' 内容月份不符：' + file.month)
      return undefined
    }
    return file
  }

  async putPartitionFile(file: PartitionFile): Promise<void> {
    await this.signedRequest('PUT', 'records/' + file.month + '.json', encodePartitionFile(file), 'application/json')
  }

  // ---- 类型模板文件 ----
  async getTypeTemplatesFile(): Promise<TypeTemplatesFile | undefined> {
    const res = await this.signedRequest('GET', 'type-templates.json')
    if (res.status === 404) return undefined
    try {
      return decodeTypeTemplatesFile(await res.text())
    } catch (err) {
      console.warn(
        '云端类型模板文件损坏：' +
          (err instanceof Error ? err.message : String(err)),
      )
      return undefined
    }
  }

  async putTypeTemplatesFile(file: TypeTemplatesFile): Promise<void> {
    await this.signedRequest(
      'PUT',
      'type-templates.json',
      encodeTypeTemplatesFile(file),
      'application/json',
    )
  }

  // ---- 图片对象 ----
  async putImage(imageId: string, blob: Blob): Promise<void> {
    // aws4fetch 的签名体只接受 string/ArrayBuffer/ArrayBufferView，Blob 先取字节
    const body = await blob.arrayBuffer()
    await this.signedRequest(
      'PUT',
      this.imageKey(imageId),
      body,
      blob.type || 'application/octet-stream',
    )
  }

  async deleteImage(imageId: string): Promise<void> {
    await this.signedRequest('DELETE', this.imageKey(imageId))
  }

  /** 列出云端全部图片对象 ID（ListObjectsV2，prefix=images/，自动翻页）。 */
  async listImages(): Promise<string[]> {
    const ids: string[] = []
    let continuationToken: string | undefined
    for (;;) {
      const url = new URL(this.baseUrl)
      url.searchParams.set('list-type', '2')
      url.searchParams.set('prefix', 'images/')
      if (continuationToken) url.searchParams.set('continuation-token', continuationToken)
      const res = await this.client.fetch(url.toString(), { method: 'GET' })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        const code = /<Code>([^<]+)<\/Code>/.exec(detail)?.[1]
        throw new R2HttpError(
          'R2 列出图片失败（HTTP ' + res.status + '）：' + detail.slice(0, 200),
          res.status,
          code,
        )
      }
      const xml = await res.text()
      // 响应为 XML（ListBucketResult），只需取 Contents 的 Key
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
        const key = m[1]
        if (!key.startsWith('images/')) continue
        const id = key.endsWith('.webp')
          ? key.slice('images/'.length, -'.webp'.length)
          : key.slice('images/'.length)
        ids.push(id)
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break
      const token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)
      if (!token) break // 防御：声称截断却无续传令牌，避免死循环
      continuationToken = token[1]
    }
    return ids
  }

  // ---- 签名 URL ----
  async getSignedGetUrl(imageId: string): Promise<string> {
    const url = new URL(this.imageKey(imageId), this.baseUrl)
    // 显式短期过期：aws4fetch 默认 86400 秒太长；R2 在过期后拒绝该 URL
    url.searchParams.set('X-Amz-Expires', String(SIGNED_URL_EXPIRES_SECONDS))
    // 查询签名（signQuery）：签名进入 URL 查询参数，可直接用于 <img src>
    // ——浏览器无法为图片请求附加 Authorization 头（CONTEXT.md「本地签名 URL」）
    const signed = await this.client.sign(url, { aws: { signQuery: true } })
    return signed.url
  }
}
