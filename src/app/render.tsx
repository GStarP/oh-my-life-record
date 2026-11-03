import React from 'react'
import ReactDOM from 'react-dom/client'
import { ChakraProvider, Toast, Toaster } from '@chakra-ui/react'
import { RouterProvider } from '@tanstack/react-router'
import { system } from '../design-system/system'
import { router } from './router'
import { applyColorMode, getStoredColorMode } from '../features/preferences/color-mode'
import { toaster } from '../features/notifications/toaster'

applyColorMode(getStoredColorMode())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChakraProvider value={system}>
      <RouterProvider router={router} />
      <Toaster toaster={toaster}>
        {(toast) => {
          return (
            // 使用 Chakra 官方 Indicator：状态 Toast 继承对比色，info 按官方默认不显示图标。
            <Toast.Root alignItems="center" gap="sm" minW="0" maxW="calc(100vw - 2rem)" pe="10">
              <Toast.Indicator flexShrink={0} />
              <Toast.Title flex="1" minW="0" textStyle="sm" whiteSpace="nowrap" overflowX="auto" overscrollBehaviorX="contain" touchAction="pan-x" tabIndex={0}>
                {toast.title}
              </Toast.Title>
              <Toast.CloseTrigger
                aria-label="关闭提示"
                top="50%"
                insetEnd="2"
                transform="translateY(-50%)"
              />
            </Toast.Root>
          )
        }}
      </Toaster>
    </ChakraProvider>
  </React.StrictMode>,
)
