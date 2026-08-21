/**
 * Toast 单例（Chakra v3：createToaster + 挂载于应用根）。
 * 独立模块：页面与 UI 逻辑共用，main.tsx 负责挂载 <Toaster>。
 */
import { createToaster } from '@chakra-ui/react'

export const toaster = createToaster({
  placement: 'top',
  overlap: true,
})
