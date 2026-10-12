/**
 * 云端凭证与用户主动操作状态；连接故障不影响本地使用。
 */
import { atom } from 'jotai'
import { getCredential } from './credential/credential'
import type { R2Config } from './cloud.type'

/** 当前云端凭证（初始从 localStorage 读取；undefined = 未配置）。 */
export const credentialAtom = atom<R2Config | undefined>(getCredential())

/** 只由设置页或无凭证时的离线按钮打开。 */
export const credentialModalOpenAtom = atom(false)

/** 应用级同步操作状态；同步入口和后台触发共享这一状态。 */
export const syncBusyAtom = atom(false)
