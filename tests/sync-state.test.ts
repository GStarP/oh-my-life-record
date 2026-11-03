import { expect, it, vi } from 'vitest'
vi.mock('../src/features/storage/native', () => ({ nativeData: { readPreference: vi.fn(), preference: vi.fn(async () => {}) }, nativeSql: {} }))
import { nativeData } from '../src/features/storage/native'
import { syncContext } from '../src/app/runtime'

it('本机只跟踪当前备份目标，切换目标后从该目标的完整快照重新核对', async () => {
  // 两套数据库可能恰好有相同修改序号。切换云端目标时不能复用另一套库的同步基线，
  // 否则会跳过数据库提交却传播错误的图片删除。新目标必须按未建立基线处理。
  const context = syncContext(async () => true, () => {})
  const state = { revision: 4, sequence: 8, sha256: 'a'.repeat(64) }
  vi.mocked(nativeData.readPreference).mockResolvedValue({ value: JSON.stringify({ ...state, namespace: 'A' }) })
  expect(await context.loadState('A')).toEqual(state)
  expect(await context.loadState('B')).toEqual({ revision: 0, sequence: 0 })
  await context.saveState('B', state)
  expect(nativeData.preference).toHaveBeenCalledWith({ key: 'sync-state', value: JSON.stringify({ ...state, namespace: 'B' }) })
})
