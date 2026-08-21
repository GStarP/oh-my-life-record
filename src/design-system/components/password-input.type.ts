import type { GroupProps, InputProps } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export type PasswordVisibilityIcon = {
  on: ReactNode
  off: ReactNode
}

export type PasswordVisibilityProps = {
  /** 默认是否显示密码。 */
  defaultVisible?: boolean
  /** 受控的密码显隐状态。 */
  visible?: boolean
  /** 密码显隐状态变化回调。 */
  onVisibleChange?: (visible: boolean) => void
  /** 显示与隐藏状态下的自定义图标。 */
  visibilityIcon?: PasswordVisibilityIcon
}

export interface PasswordInputProps extends InputProps, PasswordVisibilityProps {
  /** 传给内部 InputGroup 的属性。 */
  rootProps?: GroupProps
}
