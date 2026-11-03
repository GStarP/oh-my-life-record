import { withDeadline } from '../../../utils/deadline'
import { AwsClient } from 'aws4fetch'
import { nativeData } from '../../storage/native'
import { CloudDataError, CloudRequestError } from '../request-error'
import type { NativeFile, NetworkOptions } from '../../storage/native.type'
import type { CloudAdapter, CloudImage, CloudSnapshot, R2Config } from '../cloud.type'
import type { CloudTransport } from './r2.type'

const NETWORK_TIMEOUT = 15_000
const FILE_TRANSFER_TIMEOUT = 3 * 60_000

function xml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name] ?? _)
}

export class R2CloudAdapter implements CloudAdapter {
  readonly namespace: string
  private readonly client: AwsClient
  private readonly base: URL
  constructor(config: R2Config, private readonly transport: CloudTransport = (options) => nativeData.network(options)) {
    const endpoint = config.endpoint.trim().replace(/\/+$/, '')
    this.namespace = JSON.stringify([endpoint, config.bucket.trim(), 'data/'])
    this.base = new URL(endpoint + '/' + encodeURIComponent(config.bucket.trim()) + '/')
    this.client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.accessKeySecret, service: 's3', retries: 0 })
  }
  private async request(method: string, key: string, options: Partial<NetworkOptions> = {}, headers: Record<string, string> = {}) {
    const url = new URL(key.startsWith('?') ? key : 'data/' + key, this.base)
    const signed = await withDeadline(this.client.sign(url.toString(), { method, headers, aws: { signQuery: true } }), NETWORK_TIMEOUT, '云端请求签名超时')
    const timeout = options.source !== undefined || options.destination !== undefined ? FILE_TRANSFER_TIMEOUT : NETWORK_TIMEOUT
    let response
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await withDeadline(this.transport({ ...options, url: signed.url, method, headers: Object.fromEntries(signed.headers), key }), timeout, '云端请求超时')
        if (attempt === 0 && (response.status >= 500 || response.status === 429) && !(method === 'PUT' && key === 'database.sqlite')) continue
        break
      } catch (error) { if (attempt === 1 || (error instanceof Error && /timeout|超时/i.test(error.message)) || (method === 'PUT' && key === 'database.sqlite')) throw error }
    }
    if (!response) throw new CloudDataError('未收到云端响应')
    const code = /<Code>([^<]+)<\/Code>/.exec(response.body)?.[1]
    if ((response.status < 200 || response.status >= 300) && !(response.status === 404 && (method === 'HEAD' || method === 'GET') && code !== 'NoSuchBucket')) throw new CloudRequestError(`云端 ${method} 失败（${response.status}）`, response.status, code)
    return response
  }
  async getSnapshot(operationId?: string): Promise<CloudSnapshot | undefined> {
    const response = await this.request('HEAD', 'database.sqlite', { operationId })
    if (response.status === 404) return undefined
    const revision = Number(response.headers['x-amz-meta-revision'])
    const sha256 = response.headers['x-amz-meta-sha256']
    const bytes = Number(response.headers['content-length'])
    const etag = response.headers.etag
    if (!Number.isSafeInteger(revision) || revision < 1 || !/^[a-f0-9]{64}$/.test(sha256 ?? '') || !Number.isSafeInteger(bytes) || bytes < 1 || !etag || response.headers['x-amz-meta-schema-version'] !== '1') throw new CloudDataError('云端数据库元信息不完整')
    return { revision, sha256, bytes, etag }
  }
  async listImages(operationId?: string): Promise<CloudImage[]> {
    const images: CloudImage[] = []
    let token: string | undefined
    const tokens = new Set<string>()
    const paths = new Set<string>()
    do {
      const params = new URLSearchParams({ 'list-type': '2', prefix: 'data/images/', 'encoding-type': 'url' })
      if (token) params.set('continuation-token', token)
      const response = await this.request('GET', '?' + params, { operationId })
      if (response.status !== 200 || !/<ListBucketResult[\s>]/.test(response.body)) throw new CloudDataError('无法读取云端图片集合')
      for (const match of response.body.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([\s\S]*?)<\/Key>/.exec(match[1])?.[1]
        const size = Number(/<Size>(\d+)<\/Size>/.exec(match[1])?.[1])
        if (!key || !Number.isSafeInteger(size)) throw new CloudDataError('云端图片清单损坏')
        const path = decodeURIComponent(xml(key)).replace(/^data\//, '')
        if (!/^images\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(path)) throw new CloudDataError('云端图片路径不正确')
        if (paths.has(path)) throw new CloudDataError('云端返回了重复的图片')
        paths.add(path); images.push({ path, bytes: size })
      }
      token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(response.body)?.[1]
      if (token) { token = xml(token); if (tokens.has(token) || tokens.size >= 10_000) throw new CloudDataError('云端返回了重复的分页位置'); tokens.add(token) }
      if (/<IsTruncated>true<\/IsTruncated>/.test(response.body) && !token) throw new CloudDataError('云端分页位置缺失')
    } while (token)
    return images
  }
  async uploadImage(path: string, mime: string, operationId: string): Promise<void> {
    await this.request('PUT', path, { source: path, operationId }, { 'Content-Type': mime })
  }
  async uploadSnapshot(file: NativeFile, revision: number, etag: string | undefined, operationId: string): Promise<void> {
    await this.request('PUT', 'database.sqlite', { source: file.path, operationId }, {
      'Content-Type': 'application/vnd.sqlite3', 'x-amz-meta-revision': String(revision),
      'x-amz-meta-sha256': file.sha256, 'x-amz-meta-schema-version': '1',
      ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
    })
  }
  async download(key: string, destination: string, sha256: string, operationId: string, etag?: string) {
    const response = await this.request('GET', key, { destination, expectedSha256: sha256, operationId }, etag ? { 'If-Match': etag } : {})
    if (!response.file) throw new CloudDataError('云端文件不存在')
    return response.file
  }
  async deleteImage(path: string, operationId: string): Promise<void> { await this.request('DELETE', path, { operationId }) }
}
