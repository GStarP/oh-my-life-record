/** 后台云端检查的生命周期回归：延迟、重试和过期结果必须一起验证。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudRequestError } from '../src/features/cloud/request-error'
import { startSyncIndicatorMonitor } from '../src/app/sync-indicator'

const { checkForUpdates } = vi.hoisted(() => ({ checkForUpdates: vi.fn() }))
vi.mock('../src/app/runtime', () => ({ storage: {}, currentCloud: () => ({}) }))
vi.mock('../src/features/cloud/sync/engine', () => ({ checkForUpdates }))

let stop: (() => void) | undefined

function environment() {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const window = Object.assign(new EventTarget(), {
    navigator: { onLine: true },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  })
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  return { document, window }
}

beforeEach(() => {
  vi.useFakeTimers()
  checkForUpdates.mockReset().mockResolvedValue('none')
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('后台云端检查', () => {
  it('回前台等待 1.5 秒，恢复联网事件合并为一次检查', async () => {
    // 系统恢复网络需要时间，visibilitychange 与 online 也可能连续出现。
    // 启动检查完成后，恢复事件不能立刻发请求；等待窗口结束只检查一次。
    const { document, window } = environment()
    stop = startSyncIndicatorMonitor(vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    checkForUpdates.mockClear()
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(1499)
    expect(checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('暂时网络失败后等待 1.5 秒重试，成功不触发阻断', async () => {
    // 一次 fetch TypeError 不足以判定云端不可达；第二次请求成功时，
    // 必须留在当前页面，既不立即报错，也不继续安排第三次请求。
    environment()
    const onError = vi.fn()
    checkForUpdates.mockRejectedValueOnce(new TypeError('暂时网络抖动'))
    stop = startSyncIndicatorMonitor(onError)
    await vi.advanceTimersByTimeAsync(1499)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('云端 503 连续失败只重试一次，之后报告错误', async () => {
    // 暂时服务故障与网络抖动同样允许一次重试，但不能无限重试。
    // 第二次仍失败时只报告一次，让根布局执行已有的阻断流程。
    environment()
    const error = new CloudRequestError('服务暂时不可用', 503)
    const onError = vi.fn()
    checkForUpdates.mockRejectedValue(error)
    stop = startSyncIndicatorMonitor(onError)
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('凭证无效不等待网络重试', async () => {
    // 403 是明确的权限或凭证问题，等待不能解决；应直接交给配置入口，
    // 保留应用原来的强制凭证验证规则。
    environment()
    const error = new CloudRequestError('无权限', 403)
    const onError = vi.fn()
    checkForUpdates.mockRejectedValue(error)
    stop = startSyncIndicatorMonitor(onError)
    await vi.advanceTimersByTimeAsync(3000)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('切回后台取消等待中的检查和重试，后台定时器不发请求', async () => {
    // 回前台后马上再次按 Home，不应留下延迟请求或后台错误弹窗。
    // 同样，正在等待的重试必须取消，60 秒定时检查只在前台执行。
    const { document } = environment()
    const onError = vi.fn()
    stop = startSyncIndicatorMonitor(onError)
    await vi.advanceTimersByTimeAsync(0)
    checkForUpdates.mockClear()
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(checkForUpdates).not.toHaveBeenCalled()
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    checkForUpdates.mockRejectedValueOnce(new TypeError('暂时网络失败'))
    await vi.advanceTimersByTimeAsync(1500)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([0, 2000])('旧请求在回前台 %i ms 后失败，不阻断且重新检查', async (delay) => {
    // PWA 可能在恢复等待窗口内或结束之后才收到旧请求的失败结果。
    // 两种情况均应忽略过期错误，并安排一次新的前台检查；否则会立即
    // 弹出连接页，或吞掉恢复检查、只能等下一分钟的定时请求。
    const { document } = environment()
    const onError = vi.fn()
    let fail!: (error: unknown) => void
    checkForUpdates.mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    stop = startSyncIndicatorMonitor(onError)
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(delay)
    fail(new TypeError('后台挂起的请求失败'))
    await vi.advanceTimersByTimeAsync(1499)
    expect(onError).not.toHaveBeenCalled()
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
  })

  it('短暂离线恢复不阻断，持续离线在等待与重试之后阻断', async () => {
    // offline 事件也可能只是系统恢复网络时的瞬态，不能由根布局立即阻断。
    // 等待期间恢复联网应正常检查；真正持续离线则仍保持不提供离线工作的规则。
    const { window } = environment()
    const onError = vi.fn()
    stop = startSyncIndicatorMonitor(onError)
    await vi.advanceTimersByTimeAsync(0)
    checkForUpdates.mockClear()
    window.navigator.onLine = false
    window.dispatchEvent(new Event('offline'))
    await vi.advanceTimersByTimeAsync(500)
    window.navigator.onLine = true
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    checkForUpdates.mockClear()
    window.navigator.onLine = false
    window.dispatchEvent(new Event('offline'))
    await vi.advanceTimersByTimeAsync(2999)
    expect(onError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })
})
