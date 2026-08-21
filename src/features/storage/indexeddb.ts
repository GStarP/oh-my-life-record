/**
 * IndexedDbStorage：StorageAdapter 的 IndexedDB 实现。
 *
 * 对象存储：records（记录，主键 id，byTime 索引按 time 排序）、
 * images（图片暂存区，主键 imageId）、partitionState（按月同步状态）、
 * typeTemplates（类型模板，主键 type）、typeTemplateState（全局模板同步状态）。
 * 见 CONTEXT.md「图片暂存区」与 ADR-0005；分片替换（replacePartition）为
 * 单事务原子操作，见 CONTEXT.md「分片替换」。
 *
 * 本文件只含实现，接口见同目录 type.ts。
 */
import { addMonths } from 'date-fns'
import { UTCDate } from '@date-fns/utc'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { PartitionFile, PartitionState } from '../cloud/sync/engine.type'
import type { LifeRecord } from '../records/type'
import type {
  RecordTypeTemplate,
  TypeTemplateState,
} from '../type-templates/type'
import type { StorageAdapter } from './type'
import type { RecordTimeBounds, StagedImageEntry } from './type'

const DB_NAME = 'omlr'
const DB_VERSION = 1

/** 固定 UTC+8 时区（IANA Etc/GMT-8 即 UTC+8，无 DST；ADR-0003/0006）。 */
const UTC8_ZONE = 'Etc/GMT-8'

const STORE_RECORDS = 'records'
const STORE_IMAGES = 'images'
const STORE_STATES = 'partitionState'
const STORE_TYPE_TEMPLATES = 'typeTemplates'
const STORE_TYPE_TEMPLATE_STATE = 'typeTemplateState'
const TYPE_TEMPLATE_STATE_KEY = 'global'

/** 等待单个 IDBRequest 的结果；出错时以 request.error 拒绝。 */
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 读取按 byTime 索引方向上的第一条记录；空索引返回 undefined。 */
function firstCursorValue(
  request: IDBRequest<IDBCursorWithValue | null>,
): Promise<LifeRecord | undefined> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result?.value as LifeRecord | undefined)
    request.onerror = () => reject(request.error)
  })
}

/** 等待事务收尾：complete 成功；error/abort 拒绝（abort 意味着已整体回滚）。 */
function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('事务被中止'))
  })
}

/**
 * 某月（"YYYY-MM"）在 byTime 索引上的键范围：[当月 1 日 00:00+08:00, 下月 1 日 00:00+08:00)。
 * 全部由成熟库完成且机器无关：
 * - 月份进位：UTC+8 墙钟以 UTCDate 表达（UTC 字段 = 墙钟），addMonths 在 UTC 字段上运算
 *   （@date-fns/utc 官方兼容；普通 Date 的 addMonths 走设备本地时区，机器无关性不成立）；
 * - 墙钟 → 瞬间：fromZonedTime 按固定时区解析（字符串无偏移形式，任何机器一致）。
 */
function monthRange(month: string): IDBKeyRange {
  const startWall = new UTCDate(`${month}-01T00:00:00Z`)
  const endWall = addMonths(startWall, 1)
  const start = fromZonedTime(`${month}-01T00:00:00`, UTC8_ZONE)
  const end = fromZonedTime(
    formatInTimeZone(endWall, 'UTC', "yyyy-MM-dd'T'HH:mm:ss"),
    UTC8_ZONE,
  )
  return IDBKeyRange.bound(start, end, false, true)
}

/** 校验图片暂存区中的当前数据格式。 */
function readStoredImage(
  value: unknown,
): Omit<StagedImageEntry, 'id'> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { blob?: unknown; createdAt?: unknown }
  if (
    !(typeof Blob !== 'undefined' && candidate.blob instanceof Blob) ||
    typeof candidate.createdAt !== 'number' ||
    !Number.isFinite(candidate.createdAt)
  ) {
    return undefined
  }
  return {
    blob: candidate.blob,
    createdAt: candidate.createdAt,
  }
}

/** 打开（必要时创建）数据库；升级时建好所有对象存储与索引。 */
function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        const records = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' })
        records.createIndex('byTime', 'time')
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        // 图片暂存区使用 id 作为行外键，值包含 Blob 与 createdAt。
        db.createObjectStore(STORE_IMAGES)
      }
      if (!db.objectStoreNames.contains(STORE_STATES)) {
        db.createObjectStore(STORE_STATES, { keyPath: 'month' })
      }
      if (!db.objectStoreNames.contains(STORE_TYPE_TEMPLATES)) {
        db.createObjectStore(STORE_TYPE_TEMPLATES, { keyPath: 'type' })
      }
      if (!db.objectStoreNames.contains(STORE_TYPE_TEMPLATE_STATE)) {
        db.createObjectStore(STORE_TYPE_TEMPLATE_STATE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export class IndexedDbStorage implements StorageAdapter {
  private readonly db: Promise<IDBDatabase>

  /** @param dbName 数据库名，测试可传独立名隔离用例。 */
  constructor(dbName: string = DB_NAME) {
    this.db = openDatabase(dbName)
  }

  // ---- 记录 ----

  async upsertRecordAndMarkDirty(
    record: LifeRecord,
    dirtyMonths: string[],
  ): Promise<void> {
    const db = await this.db
    const tx = db.transaction([STORE_RECORDS, STORE_STATES], 'readwrite')
    try {
      tx.objectStore(STORE_RECORDS).put(record)
      const states = tx.objectStore(STORE_STATES)
      for (const month of new Set(dirtyMonths)) {
        const state = await requestResult(states.get(month)) as PartitionState | undefined
        states.put({
          month,
          remoteRevision: state?.remoteRevision ?? 0,
          dirty: true,
        })
      }
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // 事务已中止/已完成，忽略。
      }
      throw error
    }
    await transactionDone(tx)
  }

  async deleteRecordAndMarkDirty(id: string, dirtyMonth: string): Promise<void> {
    const db = await this.db
    const tx = db.transaction([STORE_RECORDS, STORE_STATES], 'readwrite')
    try {
      tx.objectStore(STORE_RECORDS).delete(id)
      const states = tx.objectStore(STORE_STATES)
      const state = await requestResult(states.get(dirtyMonth)) as PartitionState | undefined
      states.put({
        month: dirtyMonth,
        remoteRevision: state?.remoteRevision ?? 0,
        dirty: true,
      })
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // 事务已中止/已完成，忽略。
      }
      throw error
    }
    await transactionDone(tx)
  }

  // ---- 同步状态 ----

  async getPartitionState(month: string): Promise<PartitionState | undefined> {
    const db = await this.db
    const tx = db.transaction(STORE_STATES, 'readonly')
    const state = await requestResult(
      tx.objectStore(STORE_STATES).get(month),
    )
    return state as PartitionState | undefined
  }

  async putPartitionState(state: PartitionState): Promise<void> {
    const db = await this.db
    const tx = db.transaction(STORE_STATES, 'readwrite')
    tx.objectStore(STORE_STATES).put(state)
    await transactionDone(tx)
  }

  async getAllPartitionStates(): Promise<PartitionState[]> {
    const db = await this.db
    const tx = db.transaction(STORE_STATES, 'readonly')
    const all = await requestResult(
      tx.objectStore(STORE_STATES).getAll(),
    )
    return all as PartitionState[]
  }

  // ---- 类型模板 ----

  async getTypeTemplates(): Promise<RecordTypeTemplate[]> {
    const db = await this.db
    const tx = db.transaction(STORE_TYPE_TEMPLATES, 'readonly')
    return requestResult<RecordTypeTemplate[]>(
      tx.objectStore(STORE_TYPE_TEMPLATES).getAll(),
    )
  }

  async getTypeTemplate(type: string): Promise<RecordTypeTemplate | undefined> {
    const db = await this.db
    const tx = db.transaction(STORE_TYPE_TEMPLATES, 'readonly')
    const template = await requestResult(
      tx.objectStore(STORE_TYPE_TEMPLATES).get(type),
    )
    return template as RecordTypeTemplate | undefined
  }

  async putTypeTemplateAndMarkDirty(
    template: RecordTypeTemplate,
  ): Promise<void> {
    const db = await this.db
    const tx = db.transaction(
      [STORE_TYPE_TEMPLATES, STORE_TYPE_TEMPLATE_STATE],
      'readwrite',
    )
    try {
      tx.objectStore(STORE_TYPE_TEMPLATES).put(template)
      const states = tx.objectStore(STORE_TYPE_TEMPLATE_STATE)
      const state = await requestResult(
        states.get(TYPE_TEMPLATE_STATE_KEY),
      ) as ({ remoteRevision?: unknown; dirty?: unknown } | undefined)
      states.put({
        id: TYPE_TEMPLATE_STATE_KEY,
        remoteRevision:
          typeof state?.remoteRevision === 'number'
            ? state.remoteRevision
            : 0,
        dirty: true,
      })
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // 事务已中止/已完成，忽略。
      }
      throw error
    }
    await transactionDone(tx)
  }

  async deleteTypeTemplateAndMarkDirty(type: string): Promise<void> {
    const db = await this.db
    const tx = db.transaction(
      [STORE_TYPE_TEMPLATES, STORE_TYPE_TEMPLATE_STATE],
      'readwrite',
    )
    try {
      tx.objectStore(STORE_TYPE_TEMPLATES).delete(type)
      const states = tx.objectStore(STORE_TYPE_TEMPLATE_STATE)
      const state = await requestResult(
        states.get(TYPE_TEMPLATE_STATE_KEY),
      ) as ({ remoteRevision?: unknown } | undefined)
      states.put({
        id: TYPE_TEMPLATE_STATE_KEY,
        remoteRevision:
          typeof state?.remoteRevision === 'number'
            ? state.remoteRevision
            : 0,
        dirty: true,
      })
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // 事务已中止/已完成，忽略。
      }
      throw error
    }
    await transactionDone(tx)
  }

  async getTypeTemplateState(): Promise<TypeTemplateState | undefined> {
    const db = await this.db
    const tx = db.transaction(STORE_TYPE_TEMPLATE_STATE, 'readonly')
    const state = await requestResult(
      tx.objectStore(STORE_TYPE_TEMPLATE_STATE).get(TYPE_TEMPLATE_STATE_KEY),
    ) as ({ remoteRevision?: unknown; dirty?: unknown } | undefined)
    if (!state) return undefined
    return {
      remoteRevision:
        typeof state.remoteRevision === 'number' ? state.remoteRevision : 0,
      dirty: state.dirty === true,
    }
  }

  async putTypeTemplateState(state: TypeTemplateState): Promise<void> {
    const db = await this.db
    const tx = db.transaction(STORE_TYPE_TEMPLATE_STATE, 'readwrite')
    tx.objectStore(STORE_TYPE_TEMPLATE_STATE).put({
      id: TYPE_TEMPLATE_STATE_KEY,
      ...state,
    })
    await transactionDone(tx)
  }

  async replaceTypeTemplates(
    templates: RecordTypeTemplate[],
    remoteRevision: number,
  ): Promise<void> {
    const db = await this.db
    const tx = db.transaction(
      [STORE_TYPE_TEMPLATES, STORE_TYPE_TEMPLATE_STATE],
      'readwrite',
    )
    try {
      const store = tx.objectStore(STORE_TYPE_TEMPLATES)
      store.clear()
      for (const template of templates) {
        store.put(template)
      }
      tx.objectStore(STORE_TYPE_TEMPLATE_STATE).put({
        id: TYPE_TEMPLATE_STATE_KEY,
        remoteRevision,
        dirty: false,
      })
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // 事务已中止/已完成，忽略。
      }
      throw error
    }
    await transactionDone(tx)
  }

  /** 全部记录（「图片清理」扫描本地引用用；顺序无要求）。 */
  async getAllRecords(): Promise<LifeRecord[]> {
    const db = await this.db
    const tx = db.transaction(STORE_RECORDS, 'readonly')
    const records = await requestResult<LifeRecord[]>(
      tx.objectStore(STORE_RECORDS).getAll(),
    )
    return records
  }

  async getRecordTimeBounds(): Promise<RecordTimeBounds | undefined> {
    const db = await this.db
    const tx = db.transaction(STORE_RECORDS, 'readonly')
    const index = tx.objectStore(STORE_RECORDS).index('byTime')
    const earliestRequest = index.openCursor(undefined, 'next')
    const latestRequest = index.openCursor(undefined, 'prev')
    const [earliest, latest] = await Promise.all([
      firstCursorValue(earliestRequest),
      firstCursorValue(latestRequest),
    ])
    if (!earliest || !latest) return undefined
    return { earliest: earliest.time, latest: latest.time }
  }

  /** 按月读取：目标月份区间（monthRange）内的全部记录，'prev' 倒序（新在前）。 */
  async getRecordsInMonth(month: string): Promise<LifeRecord[]> {
    const db = await this.db
    const tx = db.transaction(STORE_RECORDS, 'readonly')
    const index = tx.objectStore(STORE_RECORDS).index('byTime')
    const records: LifeRecord[] = []
    await new Promise<void>((resolve, reject) => {
      const cursor = index.openCursor(monthRange(month), 'prev')
      cursor.onsuccess = () => {
        const c = cursor.result
        if (c) {
          records.push(c.value)
          c.continue()
        } else {
          resolve()
        }
      }
      cursor.onerror = () => reject(cursor.error)
    })
    return records
  }

  // ---- 图片暂存 ----

  async getImageBlob(imageId: string): Promise<Blob | undefined> {
    const db = await this.db
    const tx = db.transaction(STORE_IMAGES, 'readonly')
    const value = await requestResult(tx.objectStore(STORE_IMAGES).get(imageId))
    return readStoredImage(value)?.blob
  }

  async getStagedImages(): Promise<StagedImageEntry[]> {
    const db = await this.db
    const tx = db.transaction(STORE_IMAGES, 'readonly')
    const store = tx.objectStore(STORE_IMAGES)
    const [keys, values] = await Promise.all([
      requestResult<IDBValidKey[]>(store.getAllKeys()),
      requestResult<unknown[]>(store.getAll()),
    ])
    return values.flatMap((value, index) => {
      const entry = readStoredImage(value)
      if (!entry) return []
      return [{ ...entry, id: String(keys[index]) }]
    })
  }

  async putImageBlob(
    imageId: string,
    blob: Blob,
    createdAt: number = Date.now(),
  ): Promise<void> {
    const db = await this.db
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    tx.objectStore(STORE_IMAGES).put({ blob, createdAt }, imageId)
    await transactionDone(tx)
  }

  async deleteImageBlob(imageId: string): Promise<void> {
    const db = await this.db
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    tx.objectStore(STORE_IMAGES).delete(imageId)
    await transactionDone(tx)
  }

  // ---- 原子操作 ----

  /**
   * 分片替换：records 与 partitionState 两个存储同一事务内完成
   * 「删该月 → 写云端全集 → 复位同步状态」，原子生效或整体回滚
   * （CONTEXT.md「分片替换」；接口注释见 storage.type.ts）。
   */
  async replacePartition(file: PartitionFile): Promise<void> {
    const db = await this.db
    const tx = db.transaction([STORE_RECORDS, STORE_STATES], 'readwrite')
    try {
      const records = tx.objectStore(STORE_RECORDS)
      // 1) 删除该月全部本地记录：该月区间内索引游标逐条 cursor.delete()
      //    （IDBIndex 无 delete 方法，标准做法是游标删除，仍在本事务内）
      const index = records.index('byTime')
      const range = monthRange(file.month)
      await new Promise<void>((resolve, reject) => {
        const cursor = index.openCursor(range)
        cursor.onsuccess = () => {
          const c = cursor.result
          if (c) {
            c.delete()
            c.continue()
          } else {
            resolve()
          }
        }
        cursor.onerror = () => reject(cursor.error)
      })
      // 2) 写入云端该月记录全集
      for (const r of file.records) records.put(r)
      // 3) 复位同步状态：dirty 恒 false，由实现确定，调用方无需指定
      tx.objectStore(STORE_STATES).put({
        month: file.month,
        remoteRevision: file.revision,
        dirty: false,
      })
    } catch (err) {
      // 同步抛错（如非法 key）时事务不会自动收尾，主动中止保证回滚
      try {
        tx.abort()
      } catch {
        // 事务已中止/已完成，忽略
      }
      throw err
    }
    await transactionDone(tx)
  }
}
