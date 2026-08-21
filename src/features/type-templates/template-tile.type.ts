/** 类型模板列表与选择器共用的方形入口参数。 */
import type { TypeTemplateDisplayIcon } from './icons/icon-registry.type'

export type TypeTemplateTileProps = {
  icon?: TypeTemplateDisplayIcon
  label: string
  surface: 'page' | 'sheet'
  onClick: () => void
}
