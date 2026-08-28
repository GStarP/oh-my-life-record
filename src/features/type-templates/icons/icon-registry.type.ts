import type { IconType } from 'react-icons'
import type { TypeTemplateIcon } from '../type'

export type TypeTemplateIconComponentMap = Record<TypeTemplateIcon, IconType>

/** 图标渲染层的值；scroll 只用于“自由”的界面入口，不会持久化。 */
export type TypeTemplateDisplayIcon = TypeTemplateIcon | 'scroll'

export type TypeTemplateIconViewProps = {
  icon?: TypeTemplateDisplayIcon
  boxSize?: string | number
}
