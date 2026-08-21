import type { StorageAdapter } from '../storage/type'
import type { LifeRecord } from './type'

export type RecordWorkflowDependencies = {
  storage: StorageAdapter
}

export type RecordMutationResult = {
  /** 记录已经落库，但本地孤儿图片清理失败时返回原始错误。 */
  cleanupError?: unknown
}

/**
 * 记录写操作的唯一入口。
 *
 * UI 只负责把结果转换为列表更新和 Toast；记录落库、同步脏标记以及
 * 暂存图片清理的顺序由这个接口统一维护。
 */
export type RecordWorkflow = {
  save(
    record: LifeRecord,
    previousTime: Date | undefined,
  ): Promise<RecordMutationResult>
  delete(record: LifeRecord): Promise<RecordMutationResult>
}
