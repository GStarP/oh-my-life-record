import { nativeData } from '../storage/native'
let values: Record<string, string> = {}
export function initializePreferences(initial: Record<string, string>): void { values = { ...initial } }
export function readPreference(key: string): string | null { return values[key] ?? null }
export async function writePreference(key: string, value: string | null): Promise<void> {
  await nativeData.preference({ key, value })
  if (value === null) delete values[key]
  else values[key] = value
}
