import type { R2Config } from '../cloud.type'

/** 草稿与凭证字段相同，但允许空字符串；只有验证成功后才成为可用凭证。 */
export type CredentialDraft = R2Config

export type CredentialModalState = 'idle' | 'verifying'

export type CredentialModalProps = {
  open: boolean
  onClose: () => void
}
