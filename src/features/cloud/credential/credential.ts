/**
 * 云端凭证存取（localStorage 封装，ADR-0001）。
 *
 * 与 React 无关的模块级函数：设置页写入、首次引导读取、启动判定共用。
 * 存储键固定；损坏的 JSON 按未配置处理（引导弹窗会重新收集）。
 * 桶名由表单收集并随凭证保存。
 */
import type { R2Config } from '../cloud.type'
import type { CredentialDraft } from './credential.type'

/** localStorage 键。 */
export const CREDENTIAL_STORAGE_KEY = 'omlr-cloud-credential'

/** 表单草稿键；草稿不能覆盖已验证的凭证键。 */
export const CREDENTIAL_DRAFT_STORAGE_KEY = 'omlr-cloud-credential-draft'

function readObject(storage: Storage): Record<string, unknown> | undefined {
  return readObjectFromKey(storage, CREDENTIAL_STORAGE_KEY)
}

function readDraftObject(storage: Storage): Record<string, unknown> | undefined {
  return readObjectFromKey(storage, CREDENTIAL_DRAFT_STORAGE_KEY)
}

function readDraft(storage: Storage): CredentialDraft | undefined {
  const value = readDraftObject(storage) ?? readObject(storage)
  if (!value) return undefined
  return {
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : '',
    bucket: typeof value.bucket === 'string' ? value.bucket.trim() : '',
    accessKeyId: typeof value.accessKeyId === 'string' ? value.accessKeyId : '',
    accessKeySecret:
      typeof value.accessKeySecret === 'string' ? value.accessKeySecret : '',
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 从存储读取完整凭证；未配置、残缺或损坏返回 undefined。
 *
 * 表单草稿由 getCredentialDraft 读取，避免把残缺配置误当成可用凭证。
 */
export function getCredential(storage: Storage = localStorage): R2Config | undefined {
  return completeCredentialFromObject(readObject(storage))
}

/** 读取凭证表单草稿；残缺字段保留为空字符串，供刷新后继续填写。 */
export function getCredentialDraft(
  storage: Storage = localStorage,
): CredentialDraft | undefined {
  return readDraft(storage)
}

/** 保存已验证凭证；桶名由用户填写，写入前只去除首尾空白。 */
export function setCredential(
  config: CredentialDraft,
  storage: Storage = localStorage,
): void {
  const full: R2Config = { ...config, bucket: config.bucket.trim() }
  storage.setItem(CREDENTIAL_STORAGE_KEY, JSON.stringify(full))
  storage.removeItem(CREDENTIAL_DRAFT_STORAGE_KEY)
}

/** 保存未验证的表单草稿；不会改变当前可用凭证。 */
export function setCredentialDraft(
  config: CredentialDraft,
  storage: Storage = localStorage,
): void {
  const full: R2Config = { ...config, bucket: config.bucket.trim() }
  storage.setItem(CREDENTIAL_DRAFT_STORAGE_KEY, JSON.stringify(full))
}

/**
 * 完整性判定：端点、桶名和三项访问凭证全非空才视为已配置。
 * 启动开关：false → 全屏云端凭证配置弹窗（见 credential-modal）。
 */
export function hasCredential(config: R2Config | undefined): boolean {
  return Boolean(
    config &&
    isNonEmptyString(config.bucket) &&
    isNonEmptyString(config.endpoint) &&
    isNonEmptyString(config.accessKeyId) &&
    isNonEmptyString(config.accessKeySecret),
  )
}

/**
 * 图片资源缓存使用的云端命名空间；只包含对象实际归属的 endpoint 和 bucket，
 * 不包含访问密钥。换桶后即使图片 ID 恰好相同，也不能复用旧桶的内存资源。
 */
export function cloudResourceNamespace(config: R2Config | undefined): string {
  if (!config) return 'local'
  return JSON.stringify(['r2', config.endpoint, config.bucket])
}

function readObjectFromKey(
  storage: Storage,
  key: string,
): Record<string, unknown> | undefined {
  const raw = storage.getItem(key)
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined
    }
    return value as Record<string, unknown>
  } catch {
    return undefined
  }
}

function completeCredentialFromObject(
  value: Record<string, unknown> | undefined,
): R2Config | undefined {
  const bucket = typeof value?.bucket === 'string' ? value.bucket.trim() : ''
  if (
    !value ||
    !isNonEmptyString(bucket) ||
    !isNonEmptyString(value.endpoint) ||
    !isNonEmptyString(value.accessKeyId) ||
    !isNonEmptyString(value.accessKeySecret)
  ) {
    return undefined
  }
  return {
    endpoint: value.endpoint,
    bucket,
    accessKeyId: value.accessKeyId,
    accessKeySecret: value.accessKeySecret,
  }
}
