/**
 * 用户偏好状态：明暗模式的单点。
 */
import { atom } from 'jotai'
import { applyColorMode, getStoredColorMode } from './color-mode'
import type { ColorMode } from './color-mode.type'

const colorModeValueAtom = atom<ColorMode>(getStoredColorMode())

/**
 * 应用级明暗模式。
 *
 * 写入这个 Atom 会同时持久化并更新 html class，调用方不需要再记住
 * 「改 Atom + 调 applyColorMode」这两个必须成对出现的步骤。
 */
export const colorModeAtom = atom(
  (get) => get(colorModeValueAtom),
  (_get, set, mode: ColorMode) => {
    applyColorMode(mode)
    set(colorModeValueAtom, mode)
  },
)
