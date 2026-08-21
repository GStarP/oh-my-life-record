/** 记录属性模型的类型定义。 */
import type { TemplateAttributeKind } from '../../type-templates/type'

export type StoredAttributeValue = string | number | boolean

export type AttributeValueType = 'text' | 'number' | 'boolean'

export type AttributeRow = {
  id: string
  key: string
  valueType: AttributeValueType
  value: StoredAttributeValue
  /** 命中模板时保留实际录入方式；自由属性没有此字段。 */
  templateKind?: TemplateAttributeKind
  /** option 模板的建议值；空数组仍然允许自由输入。 */
  options?: string[]
  /** 模板预置属性锁定名称、类型和删除操作，只允许修改 value。 */
  locked?: boolean
}
