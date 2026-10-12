import type { SyncIndicator } from '../features/cloud/sync/engine.type'

export type SyncIndicatorListener = () => void

/** 连接状态优先展示；没有凭证与请求失败都表现为已离线。 */
export type SyncSnapshot = {
  connection: 'offline' | 'connecting' | 'connected'
  indicator: SyncIndicator
  /** 可达但清单损坏时保留具体原因，避免误报已同步。 */
  checkError?: unknown
}
