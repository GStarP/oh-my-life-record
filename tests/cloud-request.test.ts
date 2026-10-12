import { afterEach, describe, expect, it, vi } from 'vitest'
import { AwsClient } from 'aws4fetch'
import { R2CloudAdapter } from '../src/features/cloud/r2/r2'
import { CloudTimeoutError } from '../src/features/cloud/request-error'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('云端请求总时限', () => {
  it.each(['连接', '响应体'])('%s挂起时取消底层请求，报明确超时；下一次仍能连接', async (phase) => {
    // 弱网既可能收不到 HTTP headers，也可能只有 headers 而响应体不结束。
    // 两种情况都必须在总时限结束后退出并 abort，不能仅 race 丢下网络请求；
    // 随后再次连接应可成功，避免一次超时永久占住重连入口。全部请求使用假凭证。
    vi.useFakeTimers()
    let signal: AbortSignal | null | undefined
    const request = vi.spyOn(AwsClient.prototype, 'fetch').mockImplementationOnce(async (_, init) => {
      signal = init?.signal
      if (phase === '连接') return new Promise<Response>(() => {})
      return new Response(new ReadableStream({ start(controller) {
        signal?.addEventListener('abort', () => controller.error(new Error('已取消')))
      } }))
    }).mockResolvedValue(new Response(null, { status: 404 }))
    const cloud = new R2CloudAdapter({ endpoint: 'https://request.invalid', bucket: 'test',
      accessKeyId: 'test', accessKeySecret: 'test' })
    const pending = cloud.getManifest()
    const rejection = expect(pending).rejects.toBeInstanceOf(CloudTimeoutError)
    await vi.advanceTimersByTimeAsync(10_000)
    await rejection
    expect(signal?.aborted).toBe(true)
    await expect(cloud.getManifest()).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledTimes(2)
  })
})
