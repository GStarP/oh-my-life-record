/** 云端请求错误；具体实现可以附加供应商错误码。 */
export class CloudRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined = undefined,
  ) {
    super(message)
    this.name = 'CloudRequestError'
  }
}

/** 总时限包含签名、连接及响应体读取；超时后底层 fetch 同时取消。 */
export class CloudTimeoutError extends Error {
  constructor() {
    super('连接云端超时，请检查网络后重试')
    this.name = 'CloudTimeoutError'
  }
}

/** 已连接到云端，但清单不能用于同步决策。 */
export class CloudDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudDataError'
  }
}

/** 手动云端操作统一使用具体错误提示；后台检查不调用 toast。 */
export function cloudErrorMessage(error: unknown): string {
  if (error instanceof CloudTimeoutError) return error.message
  if (error instanceof TypeError) {
    return '连接失败，请检查网络或云端 CORS 配置'
  }
  if (error instanceof CloudRequestError) {
    if (error.code === 'NoSuchBucket') return '云端桶不存在，请在设置中检查端点和桶名'
    if ([400, 401, 403].includes(error.status)) {
      return '云端拒绝访问（HTTP ' + error.status + '），请在设置中检查凭证和权限'
    }
  }
  return error instanceof Error ? error.message : String(error)
}
