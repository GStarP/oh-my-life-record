/** 类型模板图标的稳定字符串注册表；不依赖 React 或具体图标组件。 */
import type { TypeTemplateIcon, TypeTemplateIconOption } from '../type'

export const TYPE_TEMPLATE_ICON_OPTIONS: readonly TypeTemplateIconOption[] = [
  { value: 'utensils', label: '餐饮' },
  { value: 'circle-dollar-sign', label: '费用' },
  { value: 'book-open', label: '书本' },
  { value: 'chess-pawn', label: '棋局' },
  { value: 'heart-pulse', label: '健康' },
  { value: 'aperture', label: '光圈' },
  { value: 'package', label: '包裹' },
  { value: 'library', label: '图书馆' },
  { value: 'wallet', label: '钱包' },
  { value: 'shopping-bag', label: '购物袋' },
  { value: 'film', label: '电影' },
  { value: 'music', label: '音乐' },
  { value: 'gamepad-2', label: '游戏' },
  { value: 'map-pin', label: '地点' },
  { value: 'star', label: '收藏' },
  { value: 'dumbbell', label: '运动' },
  { value: 'plane', label: '旅行' },
  { value: 'house', label: '居住' },
  { value: 'camera', label: '照片' },
  { value: 'coffee', label: '咖啡' },
]

export const DEFAULT_TYPE_TEMPLATE_ICON: TypeTemplateIcon =
  TYPE_TEMPLATE_ICON_OPTIONS[0].value

export function isTypeTemplateIcon(value: unknown): value is TypeTemplateIcon {
  return TYPE_TEMPLATE_ICON_OPTIONS.some((option) => option.value === value)
}
