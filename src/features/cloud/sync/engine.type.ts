/**
 * SyncEngine 的类型定义（与 engine.ts 逻辑分离）。
 */
import type { LifeRecord } from '../../records/type'

/** 分片同步状态：仅服务同步，不服务记录查询。 */
export type PartitionState = {
  month: string
  remoteRevision: number
  dirty: boolean
}

/** manifest.json 的当前格式。 */
export type Manifest = {
  schemaVersion: 1
  partitions: { [month: string]: number }
  typeTemplatesRevision: number
}

/** 云端某个记录分片的文件格式。 */
export type PartitionFile = {
  month: string
  revision: number
  records: LifeRecord[]
}

/**
 * 同步结果：驱动 Toast。
 * - uploaded：仅上传（更新了云端）
 * - downloaded：仅下载（更新了本地）
 * - synced：同时上传与下载（不同月份的正常同步，互不干扰）
 * - already-latest：无任何变更
 * - aborted：冲突且用户取消，整体中止
 */
export type SyncOutcome =
  | 'uploaded'
  | 'downloaded'
  | 'synced'
  | 'already-latest'
  | 'aborted'

/**
 * 同步报告：outcome 驱动 Toast；brokenMonths 列出云端损坏、无法下载的分片，
 * 供 UI 弹窗提示（损坏为极小概率事件，仅提示，不持久化状态）。
 */
export type SyncReport = {
  outcome: SyncOutcome
  brokenMonths: string[]
  /** 类型模板文件损坏或缺失时为 true；本地模板保持不变。 */
  brokenTypeTemplates?: boolean
}

/**
 * 同步按钮指示器状态（docs/设计文档.md §5.5）。
 * 两个独立维度，可同时成立：
 * - download：云端有更新（↓）
 * - upload：本地有未上传修改（↑）
 * - both：不同月同时有上传与下载需求（↑↓ 同时显示，都是正常同步）
 * - none：一致
 * 同月的上传+下载并存是冲突，由 sync 时判断，不作为独立按钮状态。
 */
export type SyncIndicator = 'none' | 'upload' | 'download' | 'both'

/**
 * 冲突确认回调：第一个参数是冲突月份，第二个参数表示全局类型模板
 * 是否冲突；true = 用云端覆盖，false = 取消（整体中止）。
 */
export type ConfirmConflict = (
  conflictMonths: string[],
  typeTemplatesConflict: boolean,
) => Promise<boolean>

/** 同步分类的处理方向；只在引擎内部使用，但类型仍集中在 type 文件。 */
export type SyncKind = 'download' | 'conflict' | 'upload' | 'none'

export type SyncClassification = {
  month: string
  kind: SyncKind
}

export type PendingImage = {
  id: string
  blob: Blob
}
