/**
 * 云端凭证存取契约测试（localStorage 封装）。
 *
 * 为什么测：凭证是应用访问云端的唯一凭据（ADR-0001），存取封装承担
 * JSON 序列化与损坏防护；完整性判定（四字段非空）决定能否发起云端请求。
 * 未配置与未验证草稿都必须保留纯本地使用能力。
 */
import { describe, expect, it } from 'vitest'
import {
  getCredential,
  getCredentialDraft,
  hasCredential,
  setCredential,
  setCredentialDraft,
} from '../src/features/cloud/credential/credential'

/** 测试用内存 Storage（Node 环境无 localStorage）。 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length(): number { return this.map.size }
  clear(): void { this.map.clear() }
  getItem(key: string): string | null { return this.map.get(key) ?? null }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null }
  removeItem(key: string): void { this.map.delete(key) }
  setItem(key: string, value: string): void { this.map.set(key, value) }
}

const config = {
  endpoint: 'https://x.r2.cloudflarestorage.com',
  bucket: 'omlr-test',
  accessKeyId: 'k',
  accessKeySecret: 's',
}

describe('云端凭证存取（localStorage 封装）', () => {
  it('set 后 get 还原同一凭证', () => {
    // 设置页验证成功后写入的四个字段必须能原样恢复，供应用重启时创建
    // 同一个 R2 客户端；任一字段在序列化过程中丢失都会使云端连接不可用。
    const s = new MemoryStorage()
    setCredential(config, s)
    expect(getCredential(s)).toEqual(config)
  })

  it('未配置、存储损坏或残缺 → 完整凭证 undefined（不抛错），草稿仍可恢复', () => {
    // 损坏的 JSON 按未配置处理，不能崩掉本地启动流程；部分填写只恢复为
    // 用户主动打开面板时的草稿，绝不能被 currentCloud 当成可用凭证。
    const s = new MemoryStorage()
    expect(getCredential(s)).toBeUndefined()
    s.setItem('omlr-cloud-credential', '{broken json')
    expect(getCredential(s)).toBeUndefined()
    setCredential(
      {
        endpoint: 'https://x',
        bucket: 'omlr-test',
        accessKeyId: '',
        accessKeySecret: 's',
      },
      s,
    )
    expect(getCredential(s)).toBeUndefined()
    expect(getCredentialDraft(s)).toEqual({
      endpoint: 'https://x',
      bucket: 'omlr-test',
      accessKeyId: '',
      accessKeySecret: 's',
    })
  })

  it('完整性判定：四字段全非空才视为已配置', () => {
    // 四个字段都完整才允许连接云端；空值和纯空白均算未配置。
    // 残缺配置不发请求，也不阻止用户继续查看和编辑本地记录。
    expect(hasCredential(config)).toBe(true)
    expect(hasCredential(undefined)).toBe(false)
    for (const field of ['endpoint', 'bucket', 'accessKeyId', 'accessKeySecret'] as const) {
      expect(hasCredential({ ...config, [field]: '' })).toBe(false)
      expect(hasCredential({ ...config, [field]: ' ' })).toBe(false)
    }
  })

  it('未验证的完整草稿不会覆盖当前可用凭证', () => {
    // 用户修改密钥后，表单要求实时落盘，但只有真实连接成功才能切换运行时凭证；
    // 否则用户尚未点击连接或输入了错误密钥时，记录页会提前使用未验证配置。
    const s = new MemoryStorage()
    setCredential(config, s)
    setCredentialDraft({
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: 'unverified-key',
      accessKeySecret: config.accessKeySecret,
    }, s)

    expect(getCredential(s)).toEqual(config)
    expect(getCredentialDraft(s)).toEqual({
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: 'unverified-key',
      accessKeySecret: config.accessKeySecret,
    })

    const fresh = new MemoryStorage()
    setCredentialDraft(config, fresh)
    expect(getCredential(fresh)).toBeUndefined()
  })
})
