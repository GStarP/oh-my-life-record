/** 记录编辑器的内部类型与公共 props。 */
import type { LifeRecord } from '../type'
import type { RecordTypeTemplate } from '../../type-templates/type'
import type { ImageDisplaySource, ImageManager } from '../images/image-manager.type'
import type { StagedImagePreview } from '../images/image-staging.type'

export type RecordEditorValues = {
  time: string
  type: string
  description: string
}

export type EditableImageProps = {
  source: ImageDisplaySource | undefined
  onError: () => void
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
  onDiscard: () => Promise<void>
  onUploadImages: (files: File[]) => Promise<StagedImagePreview[]>
  imageManager: ImageManager
  onSaved: (record: LifeRecord, previousTime: Date | undefined) => Promise<void>
  onDeleted: (record: LifeRecord) => Promise<void>
}

export type DeleteTarget = 'record' | 'attribute' | undefined
