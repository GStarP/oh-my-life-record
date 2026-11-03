import type { LifeRecord } from '../records/type'
import type { RecordTypeTemplate } from '../type-templates/type'

export type SqlValue = string | number | null
export type SqlRow = Record<string, SqlValue>
export type SqlStatement = { sql: string; values?: SqlValue[] }
export type RecordCursor = { time: number; id: string }
export type RecordQuery = { type?: string; cursor?: RecordCursor; limit?: number }
export type RecordPage = { records: LifeRecord[]; cursor?: RecordCursor }
export type ImageFile = { id: string; path: string; mime: string; bytes: number; sha256: string }
export type DatabaseInfo = { sequence: number; images: ImageFile[]; recordCount: number }
export interface SqlDriver {
  query(sql: string, values?: SqlValue[], path?: string): Promise<SqlRow[]>
  execute(statements: SqlStatement[], operationId?: string): Promise<void>
}
export interface StorageAdapter {
  queryRecords(query?: RecordQuery): Promise<RecordPage>
  saveRecord(record: LifeRecord, images?: ImageFile[]): Promise<ImageFile[]>
  deleteRecord(id: string): Promise<ImageFile[]>
  /** 按创建时间升序返回；时间相同时按类型代码点排序。 */
  getTypeTemplates(): Promise<RecordTypeTemplate[]>
  getTypeTemplate(type: string): Promise<RecordTypeTemplate | undefined>
  saveTypeTemplate(template: RecordTypeTemplate): Promise<void>
  deleteTypeTemplate(type: string): Promise<void>
  getImage(id: string): Promise<ImageFile | undefined>
  inspect(path?: string): Promise<DatabaseInfo>
}
