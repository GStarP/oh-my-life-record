/**
 * 明暗模式（dark mode）。
 *
 * Chakra v3 无内置 ColorMode：`_dark` 条件选择器为 `.dark &`（html 元素带 .dark class），
 * 明暗 token 双值由设计系统承担（见 design-system/system.ts）。这里只管切换与持久化。
 */

import type { ColorMode } from './color-mode.type'

const STORAGE_KEY = 'omlr-color-mode'

/** 读取持久化的模式；未设置默认浅色。 */
export function getStoredColorMode(): ColorMode {
  return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light'
}

/** 应用模式：持久化 + 切换 html 的 .dark class。 */
export function applyColorMode(mode: ColorMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
  document.documentElement.classList.toggle('dark', mode === 'dark')
}
