import { CloudTimeoutError } from './request-error'

/** 每次云端请求的总时限；取消真实请求，并防止签名或响应体挂起占住调用者。 */
export async function cloudRequest<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new CloudTimeoutError())
      controller.abort()
    }, 10_000)
  })
  try {
    return await Promise.race([operation(controller.signal), timeout])
  } finally {
    clearTimeout(timer)
  }
}
