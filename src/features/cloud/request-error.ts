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
