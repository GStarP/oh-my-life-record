/** 类型模板图标的 React 适配层；领域数据只保存字符串标识。 */
import { Icon } from '@chakra-ui/react'
import {
  LuAperture,
  LuBookOpen,
  LuCamera,
  LuCircleDollarSign,
  LuCoffee,
  LuDumbbell,
  LuFilm,
  LuGamepad2,
  LuHeartPulse,
  LuHouse,
  LuLibrary,
  LuMapPin,
  LuMusic,
  LuPlane,
  LuPackage,
  LuShoppingBag,
  LuScroll,
  LuStar,
  LuUtensils,
  LuWallet,
} from 'react-icons/lu'
import { FaChessPawn } from 'react-icons/fa6'
import { DEFAULT_TYPE_TEMPLATE_ICON } from './icon'
import type {
  TypeTemplateIconComponentMap,
  TypeTemplateDisplayIcon,
  TypeTemplateIconViewProps,
} from './icon-registry.type'

const TYPE_TEMPLATE_ICON_COMPONENTS: TypeTemplateIconComponentMap = {
  utensils: LuUtensils,
  'circle-dollar-sign': LuCircleDollarSign,
  'book-open': LuBookOpen,
  'chess-pawn': FaChessPawn,
  'heart-pulse': LuHeartPulse,
  aperture: LuAperture,
  package: LuPackage,
  library: LuLibrary,
  wallet: LuWallet,
  'shopping-bag': LuShoppingBag,
  film: LuFilm,
  music: LuMusic,
  'gamepad-2': LuGamepad2,
  'map-pin': LuMapPin,
  star: LuStar,
  dumbbell: LuDumbbell,
  plane: LuPlane,
  house: LuHouse,
  camera: LuCamera,
  coffee: LuCoffee,
}

export function getTypeTemplateIcon(value: TypeTemplateDisplayIcon | undefined) {
  // “不使用模板”是界面选项，不是可持久化的模板 icon；它复用同一渲染
  // 入口，但不进入领域图标注册表和模板选择器。
  if (value === 'scroll') return LuScroll
  return TYPE_TEMPLATE_ICON_COMPONENTS[value ?? DEFAULT_TYPE_TEMPLATE_ICON]
}

export function TypeTemplateIconView({
  icon,
  boxSize,
}: TypeTemplateIconViewProps) {
  return <Icon as={getTypeTemplateIcon(icon)} boxSize={boxSize} />
}
