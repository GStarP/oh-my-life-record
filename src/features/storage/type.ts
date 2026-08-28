/**
 * 本地存储能力的接口。
 *
 * 接口形状由「同步引擎需要什么」决定，而非由 IndexedDB 能力决定：
 * 例如分片替换（replacePartition）是一个原子操作，而不是
 * "删范围 + 批量写 + 更新状态"三步，让引擎去拼。
 * 真实实现（IndexedDB）与内存测试替身（tests/helpers）实现同一接口。
 */
import type { PartitionFile, PartitionState } from '../cloud/sync/engine.type'
import type { LifeRecord } from '../records/type'
import type {
  RecordTypeTemplate,
  TypeTemplateState,
} from '../type-templates/type'

export type RecordTimeBounds = {
  earliest: Date
  latest: Date
}

/** 图片暂存项：createdAt 只用于启动兜底清理本地孤儿。 */
export type StagedImageEntry = {
  id: string
  blob: Blob
  createdAt: number
}

/** 图片 Blob 暂存：本地仅存放「尚未成功上传」的图片（见 ADR-0004/0005）。 */
export interface StorageAdapter {
  /** 原子清空全部本地业务数据及同步状态；保留数据库结构，不产生待上传修改。 */
  clearAllData(): Promise<void>

  // ---- 记录 ----
  /** 原子写入记录并把指定月份标记为 dirty（记录页 CRUD 使用）。 */
  upsertRecordAndMarkDirty(record: LifeRecord, dirtyMonths: string[]): Promise<void>
  /** 原子删除记录并把原所属月份标记为 dirty（记录页 CRUD 使用）。 */
  deleteRecordAndMarkDirty(id: string, dirtyMonth: string): Promise<void>
  /**
   * 按 time 降序（最新在前）返回某月（UTC+8 "YYYY-MM"）内的全部记录。
   * time 相同时按 id 降序（确定性次序，与 IndexedDB 索引遍历一致）。
   */
  getRecordsInMonth(month: string): Promise<LifeRecord[]>

  /** 全部记录（「图片清理」扫描本地引用用；顺序无要求）。 */
  getAllRecords(): Promise<LifeRecord[]>
  /** 读取最早/最新记录时刻，用于首屏按月加载边界，不搬运全部历史记录。 */
  getRecordTimeBounds(): Promise<RecordTimeBounds | undefined>

  // ---- 图片暂存 ----
  /** 取回待上传图片的 Blob（显示本地版本用）。 */
  getImageBlob(imageId: string): Promise<Blob | undefined>
  /** 读取全部图片暂存项（启动孤儿清理用）。 */
  getStagedImages(): Promise<StagedImageEntry[]>
  /** 暂存待上传图片的 Blob；createdAt 供测试显式指定，默认当前时刻。 */
  putImageBlob(imageId: string, blob: Blob, createdAt?: number): Promise<void>
  /** 删除本地暂存（上传成功后调用，或清理孤儿时调用）。 */
  deleteImageBlob(imageId: string): Promise<void>

  // ---- 同步状态 ----
  /** 读取某月的同步状态；不存在返回 undefined。 */
  getPartitionState(month: string): Promise<PartitionState | undefined>
  /** 写入某月的同步状态。 */
  putPartitionState(state: PartitionState): Promise<void>
  /** 全部同步状态。 */
  getAllPartitionStates(): Promise<PartitionState[]>

  // ---- 类型模板 ----
  /** 读取全部类型模板；顺序由实现保证稳定即可。 */
  getTypeTemplates(): Promise<RecordTypeTemplate[]>
  /** 按类型读取模板；没有模板返回 undefined。 */
  getTypeTemplate(type: string): Promise<RecordTypeTemplate | undefined>
  /** 新增或修改模板，并标记模板集合 dirty。 */
  putTypeTemplateAndMarkDirty(template: RecordTypeTemplate): Promise<void>
  /** 删除模板，并标记模板集合 dirty。 */
  deleteTypeTemplateAndMarkDirty(type: string): Promise<void>
  /** 读取模板集合同步状态。 */
  getTypeTemplateState(): Promise<TypeTemplateState | undefined>
  /** 写入模板集合同步状态。 */
  putTypeTemplateState(state: TypeTemplateState): Promise<void>
  /** 原子替换整个模板集合并复位同步状态（下载方向）。 */
  replaceTypeTemplates(
    templates: RecordTypeTemplate[],
    remoteRevision: number,
  ): Promise<void>

  // ---- 原子操作 ----
  /**
   * 分片替换（下载方向的实现）：同一事务内
   * 「删除本地该月全部记录 → 写入云端该月全部记录 → 更新同步状态」。
   * 入参即云端分片文件（PartitionFile）：file.month 指定被替换分片，
   * file.records 为云端该月记录全集，file.revision 成为新的 remoteRevision。
   * records[].time 为 Date（ADR-0006）；云端 JSON 解析后的 string→Date
   * 转换由 CloudAdapter 实现负责。
   * 替换后 dirty 恒为 false——由实现内部确定，调用方无需指定。
   * 原子生效或整体回滚（见 CONTEXT.md「分片替换」）。
   */
  replacePartition(file: PartitionFile): Promise<void>
}
