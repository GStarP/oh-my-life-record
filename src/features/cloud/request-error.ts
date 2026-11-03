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

/** 已连接到云端，但数据库元信息不能用于同步决策。 */
export class CloudDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudDataError'
  }
}

/** 云端操作的用户提示。 */
export function cloudErrorMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return '连接失败，请检查网络和云端端点'
  }
  if (error instanceof CloudRequestError) {
    if (error.code === 'NoSuchBucket') return '云端桶不存在，请在设置中检查端点和桶名'
    if ([400, 401, 403].includes(error.status)) {
      return '云端拒绝访问（HTTP ' + error.status + '），请在设置中检查凭证和权限'
    }
  }
  return error instanceof Error ? error.message : String(error)
}
