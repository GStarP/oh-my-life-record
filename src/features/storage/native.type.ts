import type { PluginListenerHandle } from '@capacitor/core'
import type { SqlRow, SqlStatement, SqlValue } from './type'

export type NativeFile = { path: string; bytes: number; sha256: string }
export type NativeImageDraft = { token: string; uri: string; previewUri: string }
export type NativeResponse = { status: number; headers: Record<string, string>; body: string; file?: NativeFile }
export type NetworkOptions = {
  url: string; method: string; headers?: Record<string, string>; source?: string;
  destination?: string; expectedSha256?: string; operationId?: string; key?: string;
}
export type TransferProgress = { operationId: string; key: string; bytes: number; total: number }
export interface NativeDataPlugin {
  initialize(options: { schema: string }): Promise<{ preferences: Record<string, string> }>
  query(options: { sql: string; values: SqlValue[]; path?: string }): Promise<{ rows: SqlRow[] }>
  execute(options: { statements: SqlStatement[]; operationId?: string }): Promise<void>
  preference(options: { key: string; value: string | null }): Promise<void>
  readPreference(options: { key: string }): Promise<{ value: string | null }>
  prepareTransfer(options: { operationId: string; folder: string }): Promise<void>
  beginSync(options: { operationId: string }): Promise<void>
  endSync(options: { operationId: string }): Promise<void>
  snapshot(options: { operationId: string }): Promise<NativeFile>
  activate(options: { operationId: string; path: string; images: string[]; receipt: { key: string; value: string } }): Promise<void>
  pickImages(): Promise<{ images: NativeImageDraft[] }>
  releaseImages(options: { tokens: string[] }): Promise<void>
  writeImage(options: { id: string; token: string }): Promise<NativeFile & { mime: string }>
  imageSource(options: { path: string; thumbnail: boolean }): Promise<{ uri: string }>
  fileInfo(options: { path: string; verify?: boolean }): Promise<{ file?: NativeFile }>
  adoptImage(options: { operationId: string; source: string; path: string }): Promise<void>
  removeFiles(options: { paths: string[]; operationId?: string }): Promise<void>
  alignImages(options: { paths: string[]; operationId: string }): Promise<void>
  availableSpace(): Promise<{ bytes: number }>
  network(options: NetworkOptions): Promise<NativeResponse>
  addListener(eventName: 'transferProgress', listener: (event: TransferProgress) => void): Promise<PluginListenerHandle>
}
