/** 连接与后台只读检查：离线不会封锁本地，也不会自动同步。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudDataError, CloudRequestError } from '../src/features/cloud/request-error'
import {
  cancelSyncCheck, getSyncSnapshot, refreshLocalSyncIndicator, refreshSyncIndicator,
  resetSyncIndicator, startSyncIndicatorMonitor,
} from '../src/app/sync-indicator'

const { checkForUpdates, getAllPartitionStates, runtime } = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  getAllPartitionStates: vi.fn(),
  runtime: { cloud: {} as object | undefined, dirty: false },
}))
vi.mock('../src/app/runtime', () => ({
  currentCloud: () => runtime.cloud,
  storage: {
    getAllPartitionStates,
    getTypeTemplateState: async () => undefined,
  },
}))
vi.mock('../src/features/cloud/sync/engine', () => ({ checkForUpdates }))

let stop: (() => void) | undefined
function environment() {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const window = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
  })
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  return { document, window }
}

beforeEach(() => {
  vi.useFakeTimers()
  runtime.cloud = {}
  runtime.dirty = false
  checkForUpdates.mockReset().mockResolvedValue('none')
  getAllPartitionStates.mockReset().mockImplementation(async () => [{ dirty: runtime.dirty }])
  resetSyncIndicator()
  environment()
})
afterEach(() => {
  stop?.()
  stop = undefined
  cancelSyncCheck()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('离线连接与同步状态', () => {
  it('没有凭证不启动请求；持续离线仍每分钟重连，自动失败只反映在状态中', async () => {
    // 初次纯本地使用不能发无效请求；有凭证后，即使连接连续失败也只能更新
    // 离线状态。检查器没有 toast 或弹窗回调，且下一周期仍会尝试恢复。
    runtime.cloud = undefined
    stop = startSyncIndicatorMonitor()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(getSyncSnapshot().connection).toBe('offline')
    stop()
    runtime.cloud = {}
    checkForUpdates.mockRejectedValue(new TypeError('离线'))
    stop = startSyncIndicatorMonitor()
    expect(getSyncSnapshot().connection).toBe('connecting')
    await vi.advanceTimersByTimeAsync(1500)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
    expect(getSyncSnapshot().connection).toBe('offline')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(checkForUpdates).toHaveBeenCalledTimes(4)
    expect(getSyncSnapshot().connection).toBe('offline')
  })

  it('手动加入后台检查复用请求；连接成功只产生只读检查结果', async () => {
    // 点击离线按钮只重连，不应在同一次点击继续同步。手动请求与启动检查
    // 共用 Promise；已连接时下一次后台检查不能闪成“连接中”。
    let finish!: (value: string) => void
    checkForUpdates.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    stop = startSyncIndicatorMonitor()
    const first = refreshSyncIndicator()
    expect(refreshSyncIndicator()).toBe(first)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    finish('upload')
    await first
    expect(getSyncSnapshot()).toEqual({ connection: 'connected', indicator: 'upload' })

    checkForUpdates.mockReturnValueOnce(new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getSyncSnapshot().connection).toBe('connected')
  })

  it('恢复事件合并、后台暂停；旧请求的成功和失败都不能盖过新连接', async () => {
    // 系统挂起的请求可能很晚才返回。切回前台时须在 1.5 秒后重新检查，
    // 而不是一直等旧请求；旧成功不能覆盖新状态，旧错误也不能切回离线。
    const document = globalThis.document as unknown as EventTarget & { visibilityState: string }
    const window = globalThis.window
    let finish!: (value: string) => void
    checkForUpdates.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    stop = startSyncIndicatorMonitor()
    document.visibilityState = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    document.visibilityState = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(1499)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    checkForUpdates.mockResolvedValueOnce('download')
    await vi.advanceTimersByTimeAsync(1)
    finish('upload')
    await vi.advanceTimersByTimeAsync(0)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
    expect(getSyncSnapshot().indicator).toBe('download')

    let fail!: (error: unknown) => void
    checkForUpdates.mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    const old = refreshSyncIndicator()
    runtime.cloud = {}
    resetSyncIndicator()
    await refreshSyncIndicator()
    fail(new TypeError('旧凭证请求失败'))
    await old
    expect(getSyncSnapshot().connection).toBe('connected')
  })

  it('本地修改立即更新待上传，不发请求；在途检查不能隐藏新修改', async () => {
    // 云端可以一直 pending，但本地保存之后的 dirty 提示必须独立完成。
    // 模拟检查已经读到旧的 none，本地随后变 dirty，最后旧检查才返回。
    let finish!: (value: string) => void
    checkForUpdates.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = refreshSyncIndicator()
    runtime.dirty = true
    await refreshLocalSyncIndicator()
    expect(getSyncSnapshot().indicator).toBe('upload')
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    finish('none')
    await pending
    expect(getSyncSnapshot()).toEqual({ connection: 'connected', indicator: 'upload' })
    // 反向竞态同样重要：本地 dirty 读取较慢，期间收到新的云端更新时，
    // 本地读取结果必须保留刚得到的下载提示，不能盖回旧的单向“待上传”。
    let finishLocal!: (value: { dirty: boolean }[]) => void
    getAllPartitionStates.mockReturnValueOnce(new Promise((resolve) => { finishLocal = resolve }))
    const local = refreshLocalSyncIndicator()
    checkForUpdates.mockResolvedValueOnce('download')
    await refreshSyncIndicator()
    finishLocal([{ dirty: true }])
    await local
    expect(getSyncSnapshot().indicator).toBe('both')
  })

  it('同步执行时跳过后台检查；权限错误与损坏清单都不会误报已同步', async () => {
    // 写操作与只读检查不能竞争。权限错误不是暂时抖动，不做延迟重试；
    // manifest 损坏代表云端可达但数据不可检查，应保留独立错误供手动提示。
    let busy = true
    stop = startSyncIndicatorMonitor(() => busy)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(checkForUpdates).not.toHaveBeenCalled()
    busy = false
    checkForUpdates.mockRejectedValue(new CloudRequestError('无权限', 403))
    await vi.advanceTimersByTimeAsync(63_000)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    expect(getSyncSnapshot().connection).toBe('offline')
    const error = new CloudDataError('云端 manifest.json 损坏')
    checkForUpdates.mockRejectedValueOnce(error)
    await expect(refreshSyncIndicator()).rejects.toBe(error)
    expect(getSyncSnapshot()).toMatchObject({ connection: 'connected', checkError: error })
  })
})
