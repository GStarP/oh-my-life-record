import type { LifeRecord } from '../records/type'
import type { RecordTypeTemplate } from '../type-templates/type'
import { isTypeTemplateIcon } from '../type-templates/icons/icon'
import { validateTemplate } from '../type-templates/model'
import type { DatabaseInfo, ImageFile, RecordPage, RecordQuery, SqlDriver, SqlRow, SqlStatement, SqlValue, StorageAdapter } from './type'

const changed: SqlStatement = { sql: 'UPDATE meta SET change_seq = change_seq + 1 WHERE id = 1' }
function imageFromRow(row: SqlRow): ImageFile {
  return { id: String(row.id), path: String(row.path), mime: String(row.mime), bytes: Number(row.bytes), sha256: String(row.sha256) }
}

function attributesFrom(text: string): LifeRecord['attributes'] {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some((item) => !['string', 'boolean'].includes(typeof item) && !(typeof item === 'number' && Number.isFinite(item)))) throw new Error('记录属性不正确')
  return value as LifeRecord['attributes']
}
function templateFrom(row: SqlRow): RecordTypeTemplate {
  const template: RecordTypeTemplate = { type: String(row.type), icon: row.icon as RecordTypeTemplate['icon'], attributes: JSON.parse(String(row.attributes)), ...(row.created_at === undefined ? {} : { createdAt: Number(row.created_at) }) }
  if (!isTypeTemplateIcon(template.icon) || !Array.isArray(template.attributes) || !template.attributes.every((attribute) => attribute && typeof attribute.name === 'string' && (attribute.options === undefined || Array.isArray(attribute.options) && attribute.options.every((option) => typeof option === 'string'))) || validateTemplate(template)) throw new Error('类型模板不正确')
  return template
}

/** 事务保存业务数据，返回失去最后一个引用的图片。 */
export class SqliteStorage implements StorageAdapter {
  constructor(private readonly driver: SqlDriver) {}
  async queryRecords({ type = '', cursor, limit = 50 }: RecordQuery = {}): Promise<RecordPage> {
    const clauses: string[] = []
    const values: SqlValue[] = []
    if (type.trim()) { clauses.push('type_key = ?'); values.push(type.trim().toLowerCase()) }
    if (cursor) { clauses.push('(time < ? OR (time = ? AND id < ?))'); values.push(cursor.time, cursor.time, cursor.id) }
    const count = Math.max(1, Math.min(limit, 200))
    values.push(count + 1)
    const rows = await this.driver.query(`SELECT * FROM records ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY time DESC, id DESC LIMIT ?`, values)
    const records: LifeRecord[] = []
    for (const row of rows.slice(0, count)) {
      const images = await this.driver.query('SELECT image_id FROM record_images WHERE record_id = ? ORDER BY position', [row.id])
      records.push({ id: String(row.id), time: new Date(Number(row.time)), type: String(row.type), name: String(row.name), description: String(row.description), attributes: attributesFrom(String(row.attributes)), images: images.map((image) => String(image.image_id)) })
    }
    const last = records.at(-1)
    return { records, cursor: rows.length > count && last ? { time: last.time.getTime(), id: last.id } : undefined }
  }
  private async referencedBy(id: string): Promise<ImageFile[]> {
    return (await this.driver.query('SELECT DISTINCT images.* FROM images JOIN record_images ON image_id=images.id WHERE record_id=?', [id])).map(imageFromRow)
  }
  private async removed(images: ImageFile[]): Promise<ImageFile[]> {
    const remaining = await Promise.all(images.map(async (image) => await this.getImage(image.id) ? undefined : image))
    return remaining.filter((image): image is ImageFile => image !== undefined)
  }
  private prune(images: ImageFile[]): SqlStatement[] {
    return images.map((image) => ({ sql: 'DELETE FROM images WHERE id=? AND NOT EXISTS (SELECT 1 FROM record_images WHERE image_id=images.id)', values: [image.id] }))
  }
  async saveRecord(record: LifeRecord, images: ImageFile[] = []): Promise<ImageFile[]> {
    const candidates = await this.referencedBy(record.id)
    const statements: SqlStatement[] = images.map((image) => ({ sql: 'INSERT INTO images(id,path,mime,bytes,sha256) VALUES(?,?,?,?,?)', values: [image.id, image.path, image.mime, image.bytes, image.sha256] }))
    statements.push(
      { sql: 'INSERT OR REPLACE INTO records(id,time,type,type_key,name,description,attributes) VALUES(?,?,?,?,?,?,?)', values: [record.id, record.time.getTime(), record.type, record.type.trim().toLowerCase(), record.name, record.description, JSON.stringify(record.attributes)] },
      { sql: 'DELETE FROM record_images WHERE record_id = ?', values: [record.id] },
      ...record.images.map((id, position) => ({ sql: 'INSERT INTO record_images(record_id,image_id,position) VALUES(?,?,?)', values: [record.id, id, position] })), ...this.prune(candidates), changed,
    )
    await this.driver.execute(statements)
    return this.removed(candidates).catch(() => [])
  }
  async deleteRecord(id: string): Promise<ImageFile[]> {
    const candidates = await this.referencedBy(id)
    await this.driver.execute([{ sql: 'DELETE FROM records WHERE id = ?', values: [id] }, ...this.prune(candidates), changed])
    return this.removed(candidates).catch(() => [])
  }
  async getTypeTemplates(): Promise<RecordTypeTemplate[]> {
    return (await this.driver.query('SELECT * FROM type_templates ORDER BY created_at, type')).map(templateFrom)
  }
  async getTypeTemplate(type: string) { return (await this.getTypeTemplates()).find((template) => template.type === type) }
  async saveTypeTemplate(template: RecordTypeTemplate): Promise<void> {
    const attributes = JSON.stringify(template.attributes)
    await this.driver.execute([
      { sql: 'INSERT OR IGNORE INTO type_templates(type,icon,attributes,created_at) VALUES(?,?,?,?)', values: [template.type, template.icon, attributes, Date.now()] },
      { sql: 'UPDATE type_templates SET icon=?,attributes=? WHERE type=?', values: [template.icon, attributes, template.type] },
      changed,
    ])
  }
  async deleteTypeTemplate(type: string): Promise<void> {
    await this.driver.execute([{ sql: 'DELETE FROM type_templates WHERE type = ?', values: [type] }, changed])
  }
  async getImage(id: string) { const rows = await this.driver.query('SELECT * FROM images WHERE id = ?', [id]); return rows[0] ? imageFromRow(rows[0]) : undefined }
  async inspect(path?: string): Promise<DatabaseInfo> {
    const check = await this.driver.query('PRAGMA integrity_check', [], path)
    const version = await this.driver.query('PRAGMA user_version', [], path)
    const application = await this.driver.query('PRAGMA application_id', [], path)
    if (Object.values(check[0] ?? {})[0] !== 'ok' || Number(version[0]?.user_version) !== 1 || Number(application[0]?.application_id) !== 1330465874) throw new Error('数据库格式或完整性校验失败')
    if ((await this.driver.query('PRAGMA foreign_key_check', [], path)).length) throw new Error('数据库图片引用校验失败')
    const [meta, images, records] = await Promise.all([
      this.driver.query('SELECT change_seq FROM meta WHERE id=1', [], path),
      this.driver.query('SELECT images.* FROM images WHERE EXISTS (SELECT 1 FROM record_images WHERE image_id=images.id) ORDER BY id', [], path),
      this.driver.query('SELECT COUNT(*) AS count FROM records', [], path),
    ])
    const sequence = Number(meta[0]?.change_seq)
    const files = images.map(imageFromRow)
    if (!Number.isSafeInteger(sequence) || sequence < 0 || files.some((image) => !/^images\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(image.path) || !/^[a-f0-9]{64}$/.test(image.sha256) || !Number.isSafeInteger(image.bytes) || image.bytes < 0 || !image.mime)) throw new Error('数据库元信息不正确')
    const invalidTime = await this.driver.query('SELECT id FROM records WHERE time < -8640000000000000 OR time > 8640000000000000 OR time != CAST(time AS INTEGER) LIMIT 1', [], path)
    if (invalidTime.length) throw new Error('记录时间不正确')
    for (const row of await this.driver.query('SELECT id,time,type,type_key,name,description,attributes FROM records', [], path)) {
      if (!['id', 'type', 'type_key', 'name', 'description', 'attributes'].every((key) => typeof row[key] === 'string') || row.type_key !== String(row.type).trim().toLowerCase()) throw new Error('记录字段不正确')
      attributesFrom(String(row.attributes))
    }
    for (const row of await this.driver.query('SELECT * FROM type_templates', [], path)) templateFrom(row)
    if ((await this.driver.query('SELECT record_id FROM record_images GROUP BY record_id HAVING MIN(position)!=0 OR MAX(position)!=COUNT(*)-1', [], path)).length) throw new Error('图片顺序不正确')
    return { sequence, images: files, recordCount: Number(records[0]?.count) }
  }
}
