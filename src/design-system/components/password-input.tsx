import {
  IconButton,
  Input,
  InputGroup,
  useControllableState,
} from '@chakra-ui/react'
import type { ButtonProps } from '@chakra-ui/react'
import { forwardRef } from 'react'
import { LuEye, LuEyeOff } from 'react-icons/lu'
import type { PasswordInputProps } from './password-input.type'

/**
 * Chakra UI 官方 Password Input CLI snippet 的项目封装。
 *
 * 显隐状态由 Chakra 的受控状态 hook 管理，输入本身仍然是 Chakra Input，
 * 因此可以直接接入 react-hook-form 的 register。
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      rootProps,
      defaultVisible,
      visible: visibleProp,
      onVisibleChange,
      visibilityIcon = { on: <LuEye />, off: <LuEyeOff /> },
      ...rest
    },
    ref,
  ) {
    const [visible, setVisible] = useControllableState({
      value: visibleProp,
      defaultValue: defaultVisible ?? false,
      onChange: onVisibleChange,
    })

    return (
      <InputGroup
        endElement={
          <PasswordVisibilityTrigger
            disabled={rest.disabled}
            onPointerDown={(event) => {
              if (rest.disabled || event.button !== 0) return
              event.preventDefault()
              setVisible((current) => !current)
            }}
          >
            {visible ? visibilityIcon.off : visibilityIcon.on}
          </PasswordVisibilityTrigger>
        }
        {...rootProps}
      >
        <Input {...rest} ref={ref} type={visible ? 'text' : 'password'} />
      </InputGroup>
    )
  },
)

const PasswordVisibilityTrigger = function PasswordVisibilityTrigger(
  props: ButtonProps,
) {
  return (
    <IconButton
      tabIndex={-1}
      me='-2'
      aspectRatio='square'
      size='sm'
      variant='ghost'
      height='calc(100% - {spacing.2})'
      aria-label='切换密码显隐'
      {...props}
    />
  )
}
