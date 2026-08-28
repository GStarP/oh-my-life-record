/**
 * R2 真实冒烟测试：以真实凭证连通 Cloudflare R2，验证关键读写与签名路径。
 *
 * 手动运行（不纳入常规测试；`.env.smoke` 缺失或不完整时全部用例自动跳过）：
 *   pnpm vitest run tests/r2.smoke.test.ts --mode smoke
 *
 * 隔离桶约定（测试不得碰生产桶）：
 * - R2_BUCKET 必须是专用隔离桶：桶名以 -smoke 结尾（启动时强制校验，
 *   防止误指向生产桶），与生产桶（如 omlr）完全隔离；
 * - 桶不存在时自动创建（S3 CreateBucket）；无创建权限则报错提示手动创建；
 * - 只写伪造数据（伪月份 2999-12、随机图片 ID），结束自动清理现场
 *   并恢复 manifest（若桶里原本有）。
 *
 * 安全约定：凭证只保存在被 Git 忽略的 `.env.smoke`，不进入提交。
 */
/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AwsClient } from 'aws4fetch'
import { loadEnv } from 'vite'
import { R2CloudAdapter } from '../src/features/cloud/r2/r2'
import type { R2Config } from '../src/features/cloud/cloud.type'
import type { Manifest } from '../src/features/cloud/sync/engine.type'
import type { LifeRecord } from '../src/features/records/type'

// 只有显式使用 `--mode smoke` 才读取本地凭证文件；常规 `pnpm test`
// 仍应跳过真实 R2，避免日常回归测试意外产生外部网络与云端写操作。
const smokeEnv = import.meta.env.MODE === 'smoke'
  ? loadEnv('smoke', process.cwd(), '')
  : {}
const env = {
  endpoint: process.env.R2_ENDPOINT ?? smokeEnv.R2_ENDPOINT,
  bucket: process.env.R2_BUCKET ?? smokeEnv.R2_BUCKET,
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? smokeEnv.R2_ACCESS_KEY_ID,
  accessKeySecret:
    process.env.R2_ACCESS_KEY_SECRET ?? smokeEnv.R2_ACCESS_KEY_SECRET,
}
const hasCreds = Boolean(
  env.endpoint && env.bucket && env.accessKeyId && env.accessKeySecret,
)
const config: R2Config = {
  endpoint: env.endpoint ?? '',
  bucket: env.bucket ?? '',
  accessKeyId: env.accessKeyId ?? '',
  accessKeySecret: env.accessKeySecret ?? '',
}

// 伪月份与随机图片 ID：冒烟只写伪造数据，绝不与真实数据冲突
const FAKE_MONTH = '2999-12'
const imageId = 'smoke-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)

function rec(id: string, time: string): LifeRecord {
  return { id, time: new Date(time), type: '冒烟', name: 'R2 冒烟测试', description: '真实 R2 冒烟测试数据', images: [imageId], attributes: {} }
}

// 直接操作 S3 的原始客户端：仅用于清理现场（接口之外的键），不进契约
const rawClient = new AwsClient({
  accessKeyId: env.accessKeyId ?? '',
  secretAccessKey: env.accessKeySecret ?? '',
})

// 桶根 URL 拼接（与 R2CloudAdapter 内部一致：endpoint/{bucket}/）
const bucketBase = (e: string) =>
  'https://' + e.replace(/^https?:\/\//, '') + '/' + env.bucket

// manifest 现场快照（三态）：null = 尚未快照（测试 1 未开始）；
// undefined = 桶原本无 manifest；Manifest = 原始内容
let originalManifest: Manifest | undefined | null = null

// 隔离桶自检：桶名必须 -smoke 结尾；不存在时自动创建（S3 CreateBucket）
async function ensureSmokeBucket(): Promise<void> {
  const probe = await rawClient.fetch(bucketBase(env.endpoint!) + '/?list-type=2&max-keys=1', {
    method: 'GET',
  })
  if (probe.status !== 404) return // 桶已存在（或权限不足但可访问）
  const create = await rawClient.fetch(bucketBase(env.endpoint!) + '/', { method: 'PUT' })
  if (!create.ok && create.status !== 409) {
    throw new Error(
      '隔离桶不存在且自动创建失败（HTTP ' + create.status + '）：请在 R2 控制台手动创建 ' + env.bucket,
    )
  }
}

describe('R2 冒烟（真实云端，手动运行）', () => {
  beforeAll(async () => {
    if (!hasCreds) return
    // 测试必须与生产数据隔离：强制 -smoke 后缀防止误用生产桶。
    if (!env.bucket!.endsWith('-smoke')) {
      throw new Error('冒烟测试必须使用专用隔离桶（桶名以 -smoke 结尾，如 omlr-smoke），禁止指向生产桶')
    }
    await ensureSmokeBucket()
  })

  const adapter = () => new R2CloudAdapter(config)

  it.runIf(hasCreds)('manifest 与分片往返：Date 绝对瞬间无损，跨月归属不丢', async () => {
    // 端到端验证云端 JSON 序列化（ADR-0006）：写入一个 UTC+8 归属 9 月 1 日
    // 的跨月瞬间，读回必须仍是同一绝对瞬间（getTime 相等）且为 Date 对象。
    const c = adapter()
    // 先快照现场 manifest：putManifest 是整体覆盖，结束时必须原样恢复
    // putManifest 是整体覆盖，因此先快照并在结束时恢复原始 manifest，
    // 避免冒烟测试影响隔离桶中已有的测试数据。
    originalManifest = await c.getManifest()

    const fakeManifest: Manifest = { schemaVersion: 1, typeTemplatesRevision: 0, partitions: { [FAKE_MONTH]: 1 } }
    await c.putManifest(fakeManifest)
    expect(await c.getManifest()).toEqual(fakeManifest)

    await c.putPartitionFile({
      month: FAKE_MONTH,
      revision: 1,
      records: [rec('smoke-rec', '2026-08-31T17:30:00.000Z')],
    })
    const back = await c.getPartitionFile(FAKE_MONTH)
    expect(back?.month).toBe(FAKE_MONTH)
    expect(back?.revision).toBe(1)
    expect(back?.records[0].time).toBeInstanceOf(Date)
    expect(back?.records[0].time.getTime()).toBe(new Date('2026-08-31T17:30:00.000Z').getTime())
    expect(back?.records[0].images).toEqual([imageId])
  })

  it.runIf(hasCreds)('putImage + listImages：写入可见、删除后消失', async () => {
    // listImages 是「清理云端图片」功能（扫描云端全部图片）的数据基础：
    // 验证上传后出现在列表、删除后从列表消失。图片本体正确性由
    // 「签名 GET URL 真实可访问」用例端到端验证（接口无 getImage，
    // 显示一律走签名 URL，见 cloud.type.ts 注释）。
    const c = adapter()
    const bytes = new TextEncoder().encode('R2 smoke image bytes - binary check').buffer
    await c.putImage(imageId, new Blob([bytes], { type: 'image/webp' }))
    expect(await c.listImages()).toContain(imageId)

    await c.deleteImage(imageId)
    expect(await c.listImages()).not.toContain(imageId)
  })

  it.runIf(hasCreds)('签名 GET URL 真实可访问：fetch 200 且字节一致', async () => {
    // 端到端验证 SigV4 查询签名正确：R2 接受该 URL 并返回对象本体
    //（签名若错（region/service/编码问题），R2 直接拒绝 403）。
    const c = adapter()
    const bytes = new TextEncoder().encode('signed-url-body').buffer
    await c.putImage(imageId, new Blob([bytes], { type: 'image/webp' }))
    const signedUrl = await c.getSignedGetUrl(imageId)
    const res = await fetch(signedUrl)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(bytes))
    await c.deleteImage(imageId)
  })


  // 清理现场：删图片与伪分片；manifest 按快照三态恢复
  afterAll(async () => {
    if (!hasCreds) return
    const c = adapter()
    await c.deleteImage(imageId).catch(() => {})
    await rawClient.fetch(bucketBase(env.endpoint!) + '/records/' + FAKE_MONTH + '.json', {
      method: 'DELETE',
    }).catch(() => {})
    // 未快照（测试 1 未开始/失败在快照前）→ 未写入任何东西，不动；
    // 原本无 manifest → 删除被覆盖的假 manifest；原本有 → 原样写回。
    if (originalManifest === null) return
    if (originalManifest === undefined) {
      await rawClient.fetch(bucketBase(env.endpoint!) + '/manifest.json', {
        method: 'DELETE',
      }).catch(() => {})
    } else {
      await c.putManifest(originalManifest).catch(() => {})
    }
  })
})
