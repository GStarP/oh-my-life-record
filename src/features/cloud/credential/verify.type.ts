import type { CloudAdapter } from '../cloud.type'

/** 凭证验证只需要一次桶级读取，不依赖完整云端同步接口。 */
export type CredentialVerifier = Pick<CloudAdapter, 'listImages'>

export type VerifyResult =
  | { ok: true }
  | { ok: false; kind: 'invalid' | 'no-network' }
