/**
 * 记录属性的纯模型逻辑。
 *
 * 这里不依赖 React，负责把模板规则合并到记录当前已有的原始属性，
 * 以及在提交前把空值从存储对象中省略。这样表单组件只处理交互，不
 * 需要知道模板更新、属性类型映射和空值语义。
 */
import { ulid } from 'ulidx'
import type {
  RecordTypeTemplate,
  TemplateAttribute,
  TemplateAttributeKind,
} from '../../type-templates/type'
import type {
  AttributeRow,
  AttributeValueType,
  StoredAttributeValue,
} from './attribute-model.type'

export function valueTypeForTemplateKind(
  kind: TemplateAttributeKind,
): AttributeValueType {
  if (kind === 'boolean') return 'boolean'
  if (kind === 'number') return 'number'
  return 'text'
}

function inferValueType(value: StoredAttributeValue): AttributeValueType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  return 'text'
}

export function initialAttributeValue(
  valueType: AttributeValueType,
): StoredAttributeValue {
  if (valueType === 'boolean') return false
  // 数值输入初始为空；用户明确输入 0 后才会保存数字 0。
  if (valueType === 'number') return ''
  return ''
}

function valueForTemplate(
  value: StoredAttributeValue | undefined,
  attribute: TemplateAttribute,
): StoredAttributeValue {
  if (value === undefined) return initialAttributeValue(valueTypeForTemplateKind(attribute.kind))
  if (attribute.kind === 'boolean') return typeof value === 'boolean' ? value : Boolean(value)
  if (attribute.kind === 'number') {
    if (typeof value === 'number') return value
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return typeof value === 'string' ? value : String(value)
}

function rowFromValue(
  key: string,
  value: StoredAttributeValue | undefined,
  templateAttribute?: TemplateAttribute,
): AttributeRow {
  const inferredValue = value ?? ''
  return {
    id: ulid(),
    key,
    valueType: templateAttribute
      ? valueTypeForTemplateKind(templateAttribute.kind)
      : inferValueType(inferredValue),
    value: templateAttribute
      ? valueForTemplate(value, templateAttribute)
      : inferredValue,
    templateKind: templateAttribute?.kind,
    options: templateAttribute?.options,
    locked: templateAttribute !== undefined,
  }
}

/**
 * 将记录属性变成表单行。
 *
 * 已有属性保持原对象顺序；模板新增的属性追加在末尾。模板删除或
 * 重命名的旧属性不会被删除，会按原始值类型作为普通属性继续显示。
 */
export function attributesToRows(
  attributes: Record<string, StoredAttributeValue>,
  template?: RecordTypeTemplate,
): AttributeRow[] {
  const templateByName = new Map(
    template?.attributes.map((attribute) => [attribute.name, attribute]) ?? [],
  )
  const seen = new Set<string>()
  const rows = Object.entries(attributes).map(([key, value]) => {
    seen.add(key)
    return rowFromValue(key, value, templateByName.get(key))
  })
  for (const attribute of template?.attributes ?? []) {
    if (!seen.has(attribute.name)) {
      rows.push(rowFromValue(attribute.name, undefined, attribute))
    }
  }
  return rows
}

/** 创建一个新的自由属性行；自由属性只支持原有三种存储类型。 */
export function createAttributeRow(valueType: AttributeValueType): AttributeRow {
  return {
    id: ulid(),
    key: '',
    valueType,
    value: initialAttributeValue(valueType),
  }
}

/**
 * 将表单行收敛为记录属性。
 * 文本/选项和数值的空输入不写入；布尔 false 和数值 0 都是有效值。
 */
export function rowsToAttributes(
  rows: AttributeRow[],
): Record<string, StoredAttributeValue> {
  return rows.reduce<Record<string, StoredAttributeValue>>((attributes, row) => {
    const key = row.key.trim()
    if (!key) return attributes

    if (row.valueType === 'boolean') {
      attributes[key] = Boolean(row.value)
      return attributes
    }
    if (row.valueType === 'number') {
      if (row.value === '' || (typeof row.value === 'string' && row.value.trim() === '')) {
        return attributes
      }
      const value = typeof row.value === 'number' ? row.value : Number(row.value)
      if (Number.isFinite(value)) attributes[key] = value
      return attributes
    }
    if (typeof row.value === 'string' && row.value.trim() === '') return attributes
    attributes[key] = String(row.value)
    return attributes
  }, {})
}

export function isValidAttributeRows(rows: AttributeRow[]): boolean {
  const keys = rows.map((row) => row.key.trim())
  return keys.every(Boolean) && new Set(keys).size === keys.length
}
