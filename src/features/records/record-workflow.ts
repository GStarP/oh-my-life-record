/**
 * 记录写操作的编排层。
 *
 * 这里不依赖 React，也不持有页面状态；它隐藏两个重要事实：记录保存和
 * 删除必须同时标记对应月份为待同步，成功后还必须清理本地孤儿图片。
 */
import { cleanupLocalOrphanImages } from './images/image-staging'
import { monthOf } from '../../utils/time'
import type {
  RecordMutationResult,
  RecordWorkflow,
  RecordWorkflowDependencies,
} from './record-workflow.type'

async function cleanupOrphans(
  storage: RecordWorkflowDependencies['storage'],
): Promise<RecordMutationResult> {
  try {
    // 用户刚完成的记录操作不应留下孤儿；因此这里使用立即清理，而不是
    // 启动兜底清理所使用的 7 天保护期。
    await cleanupLocalOrphanImages(storage, Date.now(), 0)
    return {}
  } catch (cleanupError) {
    // 记录或同步状态已经成功提交，清理失败不能回滚用户刚完成的操作。
    return { cleanupError }
  }
}

export function createRecordWorkflow({
  storage,
}: RecordWorkflowDependencies): RecordWorkflow {
  return {
    async save(record, previousTime) {
      const currentMonth = monthOf(record.time)
      const dirtyMonths = [currentMonth]
      if (previousTime) {
        const previousMonth = monthOf(previousTime)
        if (previousMonth !== currentMonth) dirtyMonths.push(previousMonth)
      }
      await storage.upsertRecordAndMarkDirty(record, dirtyMonths)
      return cleanupOrphans(storage)
    },

    async delete(record) {
      await storage.deleteRecordAndMarkDirty(record.id, monthOf(record.time))
      return cleanupOrphans(storage)
    },
  }
}
