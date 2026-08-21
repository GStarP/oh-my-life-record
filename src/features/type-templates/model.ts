/** 类型模板的纯校验与归一化逻辑。 */
import type {
  RecordTypeTemplate,
  TemplateAttribute,
  TemplateAttributeKind,
} from './type'

const TEMPLATE_ATTRIBUTE_KINDS: readonly TemplateAttributeKind[] = [
  'text',
  'number',
  'boolean',
  'option',
]

function isTemplateAttributeKind(value: unknown): value is TemplateAttributeKind {
  return (
    typeof value === 'string' &&
    TEMPLATE_ATTRIBUTE_KINDS.includes(value as TemplateAttributeKind)
  )
}

/**
 * 清理表单中的模板草稿：类型名、属性名和选项值去首尾空格；
 * 空选项被忽略，避免出现“看似有选项、实际不能选”的脏配置。
 */
export function normalizeTemplate(template: RecordTypeTemplate): RecordTypeTemplate {
  return {
    type: template.type.trim(),
    icon: template.icon,
    attributes: template.attributes.map((attribute) => {
      const normalized: TemplateAttribute = {
        name: attribute.name.trim(),
        kind: attribute.kind,
      }
      if (attribute.kind === 'option') {
        normalized.options = (attribute.options ?? [])
          .map((option) => option.trim())
          .filter(Boolean)
      }
      return normalized
    }),
  }
}

/** 返回可直接展示给用户的第一条模板校验错误；undefined 表示合法。 */
export function validateTemplate(
  template: RecordTypeTemplate,
  existingTypes: Iterable<string> = [],
  editingType?: string,
): string | undefined {
  const normalized = normalizeTemplate(template)
  if (!normalized.type) return '请输入类型'
  const typeExists = new Set(existingTypes)
  if (typeExists.has(normalized.type) && normalized.type !== editingType) {
    return '这个类型已经有模板了'
  }
  const names = new Set<string>()
  for (const attribute of normalized.attributes) {
    if (!attribute.name) return '属性名不能为空'
    if (names.has(attribute.name)) return `属性名不能重复：${attribute.name}`
    names.add(attribute.name)
    if (!isTemplateAttributeKind(attribute.kind)) return '属性类型不合法'
    if (attribute.kind !== 'option' && attribute.options?.length) {
      return `属性“${attribute.name}”不是选项类型，不能配置选项`
    }
    if (attribute.kind === 'option') {
      const options = attribute.options ?? []
      if (new Set(options).size !== options.length) {
        return `选项不能重复：${attribute.name}`
      }
    }
  }
  return undefined
}

export function templateKindLabel(kind: TemplateAttributeKind): string {
  switch (kind) {
    case 'text':
      return '文本'
    case 'number':
      return '数值'
    case 'boolean':
      return '布尔'
    case 'option':
      return '选项'
  }
}
