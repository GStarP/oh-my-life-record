/**
 * 凭证配置表单使用的类型。
 *
 * 与 R2Config 分开：表单允许保存「尚未填完」的草稿，而 R2Config
 * 只代表可以实际发起请求的完整配置。桶名必须由用户明确填写。
 */
export type CredentialDraft = {
  endpoint: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
}

export type CredentialModalState = 'idle' | 'verifying'

export type CredentialModalProps = {
  /** 首次引导或云端异常：没有可用云端连接时禁止手动关闭。 */
  force?: boolean
  /** 设置页入口：受控开关，可关闭。 */
  open?: boolean
  onClose?: () => void
}
