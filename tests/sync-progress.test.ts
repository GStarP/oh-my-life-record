import { afterEach, expect, it, vi } from 'vitest'
import { createSyncProgressDisplay } from '../src/features/cloud/sync/progress'
import type { SyncProgress } from '../src/features/cloud/sync/engine.type'

afterEach(() => vi.useRealTimers())

it('阶段至少展示 800 毫秒，同阶段计数立即更新，最后阶段结束后才能关窗', async () => {
  // 快速阶段需要可读，图片计数则不能被每次延时拖慢。用虚拟时钟走过真实的
  // “检查 → 上传 → 提交”通知序列，确认切换只补剩余时间，慢步骤不再额外等待。
  // 首次通知同步发布，防止打开窗口时短暂显示上次状态；结尾也等待当前阶段满
  // 800 毫秒，覆盖成功或失败后立即关闭弹窗的闪动情况。
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
  const publish = vi.fn(), display = createSyncProgressDisplay(publish)
  const progress = (stage: string, files = 0): SyncProgress => ({ stage, files, totalFiles: 20, bytes: 0, totalBytes: 0 })
  const checking = display.update(progress('检查云端'))
  expect(publish).toHaveBeenLastCalledWith(progress('检查云端'))
  await checking
  const uploading = display.update(progress('上传图片'))
  await vi.advanceTimersByTimeAsync(799)
  expect(publish).toHaveBeenLastCalledWith(progress('检查云端'))
  await vi.advanceTimersByTimeAsync(1); await uploading
  await vi.advanceTimersByTimeAsync(300)
  await display.update(progress('上传图片', 7))
  expect(publish).toHaveBeenLastCalledWith(progress('上传图片', 7))
  const committing = display.update(progress('提交数据库快照'))
  await vi.advanceTimersByTimeAsync(499)
  expect(publish).toHaveBeenLastCalledWith(progress('上传图片', 7))
  await vi.advanceTimersByTimeAsync(1); await committing
  await vi.advanceTimersByTimeAsync(1000)
  await display.update(progress('对齐图片集合'))
  expect(publish).toHaveBeenLastCalledWith(progress('对齐图片集合'))
  let closed = false
  const finished = display.finish().then(() => { closed = true })
  await vi.advanceTimersByTimeAsync(799)
  expect(closed).toBe(false)
  await vi.advanceTimersByTimeAsync(1); await finished
  expect(closed).toBe(true)
})
