/** 记录编辑器的内部类型与公共 props。 */
import type { LifeRecord } from '../type'
import type { RecordTypeTemplate } from '../../type-templates/type'
import type { ImageStore } from '../images/files.type'
import type { DraftImage } from '../images/image-import.type'

export type RecordEditorValues = {
  time: string
  type: string
  name: string
  description: string
}

export type EditableImageProps = {
  id: string
  draft: DraftImage | undefined
  store: ImageStore
  onRemove: () => void
}

export type RecordEditorProps = {
  open: boolean
  record: LifeRecord | undefined
  /** 表单打开前解析出的类型；只用于区分初始上下文，不会自动响应输入。 */
  initialType?: string
  /** 打开前按 initialType 查到的当前模板；存在时进入模板表单状态。 */
  template?: RecordTypeTemplate
  onClose: () => void
  onPickImages: () => Promise<DraftImage[]>
  imageStore: ImageStore
  onSaved: (record: LifeRecord, drafts: DraftImage[]) => Promise<void>
  onDeleted: (record: LifeRecord) => Promise<void>
}

export type DeleteTarget =
  | { kind: 'record' }
  | { kind: 'attribute' | 'image'; id: string }
  | undefined
