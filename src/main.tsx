import React from 'react'
import ReactDOM from 'react-dom/client'
import { ChakraProvider, Toast, Toaster } from '@chakra-ui/react'
import { RouterProvider } from '@tanstack/react-router'
import { system } from './design-system/system'
import { router } from './app/router'
import { applyColorMode, getStoredColorMode } from './features/preferences/color-mode'
import { toaster } from './features/notifications/toaster'

// 启动时应用持久化的明暗模式（Chakra v3 用 html 的 .dark class）
applyColorMode(getStoredColorMode())

function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      // Service Worker 只负责离线壳；注册失败不应阻断在线应用本身。
      console.warn('PWA 离线壳注册失败', error)
    })
  })
}

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChakraProvider value={system}>
      <RouterProvider router={router} />
      <Toaster toaster={toaster}>
        {(toast) => {
          return (
            // 使用 Chakra 官方 Indicator：状态 Toast 继承对比色，info 按官方默认不显示图标。
            <Toast.Root alignItems="center" gap="sm">
              <Toast.Indicator />
              <Toast.Title flex="1" textStyle="sm">
                {toast.title}
              </Toast.Title>
              <Toast.CloseTrigger
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
