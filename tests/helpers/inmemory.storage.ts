/**
 * InMemoryStorage：StorageAdapter 的内存实现（仅供测试）。
 *
 * 仅测试用：同步引擎的单元测试依赖它——引擎不触碰浏览器 API，
 * 测试通过注入本实现断言同步规则。它不是产品代码，但必须行为正确，
 * 否则引擎测试会失去意义。
 */
import type { LifeRecord } from '../../src/features/records/type'
import type { PartitionFile, PartitionState } from '../../src/features/cloud/sync/engine.type'
import type {
  RecordTypeTemplate,
  TypeTemplateState,
} from '../../src/features/type-templates/type'
import type {
  RecordTimeBounds,
  StagedImageEntry,
  StorageAdapter,
} from '../../src/features/storage/type'
import { formatInTimeZone } from 'date-fns-tz'

/** 固定 UTC+8 时区（ADR-0003/0006）；与 IndexedDbStorage 保持一致。 */
const UTC8_ZONE = 'Etc/GMT-8'

export class InMemoryStorage implements StorageAdapter {
  /** 记录以 id 为键。 */
  private records = new Map<string, LifeRecord>()
  /** 图片暂存：id → Blob + 创建时刻。 */
  private images = new Map<string, StagedImageEntry>()
  /** 同步状态：month → state。 */
  private states = new Map<string, PartitionState>()
  /** 类型模板与记录分离存储；模板集合只有一个全局同步状态。 */
  private typeTemplates = new Map<string, RecordTypeTemplate>()
  private typeTemplateState: TypeTemplateState | undefined

  async clearAllData(): Promise<void> {
    this.records.clear()
    this.images.clear()
    this.states.clear()
    this.typeTemplates.clear()
    this.typeTemplateState = undefined
  }

  /** 仅供测试建立前置数据；生产 StorageAdapter 不暴露绕过 dirty 的写入口。 */
  async upsertRecord(record: LifeRecord): Promise<void> {
    this.records.set(record.id, record)
  }

  async upsertRecordAndMarkDirty(
    record: LifeRecord,
    dirtyMonths: string[],
  ): Promise<void> {
    this.records.set(record.id, record)
    for (const month of new Set(dirtyMonths)) {
      const state = this.states.get(month)
      this.states.set(month, {
        month,
        remoteRevision: state?.remoteRevision ?? 0,
        dirty: true,
      })
    }
  }

  async deleteRecordAndMarkDirty(id: string, dirtyMonth: string): Promise<void> {
    this.records.delete(id)
    const state = this.states.get(dirtyMonth)
    this.states.set(dirtyMonth, {
      month: dirtyMonth,
      remoteRevision: state?.remoteRevision ?? 0,
      dirty: true,
    })
  }

  async getAllRecords(): Promise<LifeRecord[]> {
    return [...this.records.values()]
  }

  async getRecordTimeBounds(): Promise<RecordTimeBounds | undefined> {
    const records = [...this.records.values()]
    if (records.length === 0) return undefined
    return records.reduce<RecordTimeBounds>(
      (bounds, record) => ({
        earliest:
          record.time < bounds.earliest ? record.time : bounds.earliest,
        latest: record.time > bounds.latest ? record.time : bounds.latest,
      }),
      { earliest: records[0].time, latest: records[0].time },
    )
  }

  async getRecordsInMonth(month: string): Promise<LifeRecord[]> {
    // 时间倒序：新的在前。
    return [...this.records.values()]
      .filter((r) => formatInTimeZone(r.time, UTC8_ZONE, 'yyyy-MM') === month)
      // time 降序（Date 按毫秒值）；并列时按 id 降序——与 IndexedDB 实现（索引遍历次序）
      // 保持一致，否则引擎测试（用本替身）与真机（IDB）在同一时刻多条记录时结果可能不同。
      .sort((a, b) => b.time.getTime() - a.time.getTime() || b.id.localeCompare(a.id))
  }

  async getImageBlob(imageId: string): Promise<Blob | undefined> {
    return this.images.get(imageId)?.blob
  }

  async getStagedImages(): Promise<StagedImageEntry[]> {
    return [...this.images.values()]
  }

  async putImageBlob(
    imageId: string,
    blob: Blob,
    createdAt: number = Date.now(),
  ): Promise<void> {
    this.images.set(imageId, { id: imageId, blob, createdAt })
  }

  async deleteImageBlob(imageId: string): Promise<void> {
    this.images.delete(imageId)
  }

  async getPartitionState(
    month: string,
  ): Promise<PartitionState | undefined> {
    return this.states.get(month)
  }

  async putPartitionState(state: PartitionState): Promise<void> {
    this.states.set(state.month, state)
  }

  async getAllPartitionStates(): Promise<PartitionState[]> {
    return [...this.states.values()]
  }

  async getTypeTemplates(): Promise<RecordTypeTemplate[]> {
    return [...this.typeTemplates.values()].map((template) => structuredClone(template))
  }

  async getTypeTemplate(type: string): Promise<RecordTypeTemplate | undefined> {
    const template = this.typeTemplates.get(type)
    return template && structuredClone(template)
  }

  async putTypeTemplateAndMarkDirty(
    template: RecordTypeTemplate,
  ): Promise<void> {
    this.typeTemplates.set(template.type, structuredClone(template))
    this.typeTemplateState = {
      remoteRevision: this.typeTemplateState?.remoteRevision ?? 0,
      dirty: true,
    }
  }

  async deleteTypeTemplateAndMarkDirty(type: string): Promise<void> {
    this.typeTemplates.delete(type)
    this.typeTemplateState = {
      remoteRevision: this.typeTemplateState?.remoteRevision ?? 0,
      dirty: true,
    }
  }

  async getTypeTemplateState(): Promise<TypeTemplateState | undefined> {
    return this.typeTemplateState && { ...this.typeTemplateState }
  }

  async putTypeTemplateState(state: TypeTemplateState): Promise<void> {
    this.typeTemplateState = { ...state }
  }

  async replaceTypeTemplates(
    templates: RecordTypeTemplate[],
    remoteRevision: number,
  ): Promise<void> {
    this.typeTemplates.clear()
    for (const template of templates) {
      this.typeTemplates.set(template.type, structuredClone(template))
    }
    this.typeTemplateState = { remoteRevision, dirty: false }
  }

  async replacePartition(file: PartitionFile): Promise<void> {
    // 内存实现没有事务，但语义必须一致：整体替换该月记录，并复位同步状态。
    const month = file.month
    for (const r of this.records.values()) {
      if (formatInTimeZone(r.time, UTC8_ZONE, 'yyyy-MM') === month) this.records.delete(r.id)
    }
    for (const r of file.records) this.records.set(r.id, r)
    this.states.set(month, {
      month,
      remoteRevision: file.revision,
      dirty: false,
    })
  }
}
