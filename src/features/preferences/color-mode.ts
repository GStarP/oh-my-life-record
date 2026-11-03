import { readPreference, writePreference } from './device'
import type { ColorMode } from './color-mode.type'
const STORAGE_KEY = 'color-mode'
export function getStoredColorMode(): ColorMode { return readPreference(STORAGE_KEY) === 'dark' ? 'dark' : 'light' }
export function applyColorMode(mode: ColorMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark')
  void writePreference(STORAGE_KEY, mode).catch(() => {})
}
