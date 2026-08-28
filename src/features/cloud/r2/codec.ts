/** R2 云端 JSON 的纯编解码与结构校验，不涉及请求或签名。 */
import { SCHEMA_VERSION } from './schema'
import type { LifeRecord } from '../../records/type'
import type {
  RecordTypeTemplate,
  TemplateAttributeKind,
  TypeTemplatesFile,
} from '../../type-templates/type'
import { isTypeTemplateIcon } from '../../type-templates/icons/icon'
import type { Manifest, PartitionFile } from '../sync/engine.type'
import type { RecordJson } from './r2.type'

/** 分片 JSON 序列化。Date 经 JSON.stringify 成为 ISO 8601 UTC 字符串（ADR-0006）。 */
export function encodePartitionFile(file: PartitionFile): string {
  return JSON.stringify(file)
}

/** 云端分片 JSON 中单条记录的形状：time 为字符串（解码前的过渡形态）。 */
function isRecordJson(value: unknown): value is RecordJson {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.time === 'string' &&
    !Number.isNaN(new Date(record.time).getTime()) &&
    typeof record.type === 'string' &&
    typeof record.name === 'string' &&
    typeof record.description === 'string' &&
    Array.isArray(record.images) &&
    typeof record.attributes === 'object' &&
    record.attributes !== null &&
    !Array.isArray(record.attributes) &&
    record.images.every((imageId) => typeof imageId === 'string') &&
    Object.values(record.attributes).every(
      (attributeValue) =>
        typeof attributeValue === 'string' ||
        typeof attributeValue === 'number' ||
        typeof attributeValue === 'boolean',
    )
  )
}

/** 分片 JSON 反序列化；损坏时抛出具体结构错误。 */
export function decodePartitionFile(text: string): PartitionFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('无法解析（JSON 损坏）')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('顶层不是对象')
  }
  const partition = parsed as {
    month?: unknown
    revision?: unknown
    records?: unknown
  }
  if (typeof partition.month !== 'string') {
    throw new Error('month 不是字符串：' + String(partition.month))
  }
  if (typeof partition.revision !== 'number') {
    throw new Error('revision 不是数字：' + String(partition.revision))
  }
  if (!Array.isArray(partition.records)) {
    throw new Error('records 不是数组')
  }
  const records: LifeRecord[] = []
  for (let index = 0; index < partition.records.length; index++) {
    const record = partition.records[index]
    if (!isRecordJson(record)) {
      throw new Error(
        '第 ' +
          index +
          ' 条记录结构不合法（id/time/type/name/description/images/attributes 类型或取值不符）',
      )
    }
    records.push({ ...record, time: new Date(record.time) })
  }
  return {
    month: partition.month,
    revision: partition.revision,
    records,
  }
}

const TEMPLATE_ATTRIBUTE_KINDS: readonly string[] = [
  'text',
  'number',
  'boolean',
  'option',
]

function isRecordTypeTemplate(value: unknown): value is RecordTypeTemplate {
  if (typeof value !== 'object' || value === null) return false
  const template = value as {
    type?: unknown
    icon?: unknown
    attributes?: unknown
  }
  if (
    typeof template.type !== 'string' ||
    template.type.trim() === '' ||
    template.type !== template.type.trim() ||
    !isTypeTemplateIcon(template.icon) ||
    !Array.isArray(template.attributes)
  ) {
    return false
  }
  const names = new Set<string>()
  return template.attributes.every((attribute) => {
    if (typeof attribute !== 'object' || attribute === null) return false
    const item = attribute as {
      name?: unknown
      kind?: unknown
      options?: unknown
    }
    if (
      typeof item.name !== 'string' ||
      item.name.trim() === '' ||
      item.name !== item.name.trim() ||
      typeof item.kind !== 'string' ||
      !TEMPLATE_ATTRIBUTE_KINDS.includes(item.kind as TemplateAttributeKind) ||
      names.has(item.name.trim())
    ) {
      return false
    }
    names.add(item.name.trim())
    if (item.kind !== 'option') return item.options === undefined
    if (item.options === undefined) return true
    return (
      Array.isArray(item.options) &&
      item.options.every(
        (option) =>
          typeof option === 'string' &&
          option !== '' &&
          option === option.trim(),
      ) &&
      new Set(item.options).size === item.options.length
    )
  })
}

/** 类型模板 JSON 序列化。 */
export function encodeTypeTemplatesFile(file: TypeTemplatesFile): string {
  return JSON.stringify(file)
}

/** 类型模板 JSON 反序列化；损坏时抛错，由同步阶段按 broken 状态处理。 */
export function decodeTypeTemplatesFile(text: string): TypeTemplatesFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('无法解析（JSON 损坏）')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('顶层不是对象')
  }
  const file = parsed as { revision?: unknown; templates?: unknown }
  if (typeof file.revision !== 'number' || !Number.isFinite(file.revision)) {
    throw new Error('revision 不是有限数字：' + String(file.revision))
  }
  if (!Array.isArray(file.templates)) throw new Error('templates 不是数组')
  const types = new Set<string>()
  for (let index = 0; index < file.templates.length; index++) {
    if (!isRecordTypeTemplate(file.templates[index])) {
      throw new Error('第 ' + index + ' 个类型模板结构不合法')
    }
    const type = (file.templates[index] as RecordTypeTemplate).type
    if (types.has(type)) throw new Error('类型模板重复：' + type)
    types.add(type)
  }
  return {
    revision: file.revision,
    templates: file.templates as RecordTypeTemplate[],
  }
}

/** manifest JSON 序列化。 */
export function encodeManifest(manifest: Manifest): string {
  return JSON.stringify(manifest)
}

/** manifest JSON 反序列化；损坏时抛出具体结构错误。 */
export function decodeManifest(text: string): Manifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('无法解析（JSON 损坏）')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('顶层不是对象')
  }
  const manifest = parsed as {
    schemaVersion?: unknown
    partitions?: unknown
    typeTemplatesRevision?: unknown
  }
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('schemaVersion 不合法：' + String(manifest.schemaVersion))
  }
  if (
    typeof manifest.partitions !== 'object' ||
    manifest.partitions === null ||
    Array.isArray(manifest.partitions)
  ) {
    throw new Error('partitions 缺失或不是对象')
  }
  for (const revision of Object.values(manifest.partitions)) {
    if (typeof revision !== 'number' || !Number.isFinite(revision)) {
      throw new Error('分片版本不是数字：' + String(revision))
    }
  }
  if (
    typeof manifest.typeTemplatesRevision !== 'number' ||
    !Number.isFinite(manifest.typeTemplatesRevision)
  ) {
    throw new Error(
      '类型模板版本不是数字：' + String(manifest.typeTemplatesRevision),
    )
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    partitions: manifest.partitions as Manifest['partitions'],
    typeTemplatesRevision: manifest.typeTemplatesRevision,
  }
}
