/**
 * 云端凭证存取契约测试（localStorage 封装）。
 *
 * 为什么测：凭证是应用访问云端的唯一凭据（ADR-0001），存取封装承担
 * JSON 序列化与损坏防护；完整性判定（四字段非空）决定「首次引导弹窗是否出现」，
 * 是应用启动流程的开关，值得锁住。
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
    // 同一个 R2 客户端；任一字段在序列化过程中丢失都会重新触发阻断弹窗。
    const s = new MemoryStorage()
    setCredential(config, s)
    expect(getCredential(s)).toEqual(config)
  })

  it('未配置、存储损坏或残缺 → 完整凭证 undefined（不抛错），草稿仍可恢复', () => {
    // 损坏的 JSON 不能崩掉启动流程：按未配置处理，
    // 让引导弹窗出现、用户重新配置即可；部分填写则只恢复到表单草稿，
    // 绝不能被 currentCloud 当成可用凭证。
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
    // 启动开关：hasCredential=false → 弹全屏引导。任何一个字段为空
    //（用户只填了一半就关闭）都算未配置，不能带着残缺凭证进应用。
    expect(hasCredential(config)).toBe(true)
    expect(hasCredential(undefined)).toBe(false)
    expect(hasCredential({ ...config, bucket: '' })).toBe(false)
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
