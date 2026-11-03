/** 当前图标选择器展示并允许持久化的图标标识。 */
export type TypeTemplateIcon =
  | 'utensils'
  | 'circle-dollar-sign'
  | 'book-open'
  | 'chess-pawn'
  | 'heart-pulse'
  | 'aperture'
  | 'package'
  | 'library'
  | 'wallet'
  | 'shopping-bag'
  | 'film'
  | 'music'
  | 'gamepad-2'
  | 'map-pin'
  | 'star'
  | 'dumbbell'
  | 'plane'
  | 'house'
  | 'camera'
  | 'coffee'

export type TypeTemplateIconOption = {
  value: TypeTemplateIcon
  label: string
}

/** 模板预置属性支持的四种录入方式。 */
export type TemplateAttributeKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'option'

/** 一个模板预置属性。name 同时是记录 attributes 中的键。 */
export type TemplateAttribute = {
  name: string
  kind: TemplateAttributeKind
  /** 仅 option 使用；为空数组表示没有建议项，但仍允许自由输入。 */
  options?: string[]
}

/** 一个类型至多对应一个模板，type 就是模板的身份和显示名称。 */
export type RecordTypeTemplate = {
  type: string
  icon: TypeTemplateIcon
  attributes: TemplateAttribute[]
  /** 创建时间，单位毫秒；未保存的表单草稿可以省略。 */
  createdAt?: number
}

export type TemplateDraftAttribute = {
  id: string
  name: string
  kind: TemplateAttributeKind
  options: string[]
}

export type TypeTemplateEditorProps = {
  open: boolean
  template: RecordTypeTemplate | undefined
  existingTypes: string[]
  onClose: () => void
  onSaved: (template: RecordTypeTemplate) => Promise<void>
  onDeleted: (type: string) => Promise<void>
}

export type TypeTemplatePickerProps = {
  open: boolean
  templates: RecordTypeTemplate[]
  onClose: () => void
  onSelect: (template: RecordTypeTemplate | undefined) => void
}
