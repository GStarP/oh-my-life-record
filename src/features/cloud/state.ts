/**
 * 云端配置状态：凭证与云端异常阻断状态的单点。
 */
import { atom } from 'jotai'
import { getCredential, hasCredential } from './credential/credential'
import type { R2Config } from './cloud.type'

function readOnlineState(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

/** 当前云端凭证（初始从 localStorage 读取；undefined = 未配置）。 */
export const credentialAtom = atom<R2Config | undefined>(getCredential())

/** 云端异常时阻断应用，直到用户重新验证配置。 */
export const cloudBlockedAtom = atom(false)

/** 当前网络状态；由根布局监听 online/offline 事件，页面只订阅。 */
export const onlineAtom = atom(readOnlineState())

/** 应用级同步操作状态；同步入口和后台触发共享这一状态。 */
export const syncBusyAtom = atom(false)

/** 是否可以进入应用：必须有完整凭证，且当前没有云端异常阻断。 */
export const configuredAtom = atom(
  (get) => hasCredential(get(credentialAtom)) && !get(cloudBlockedAtom),
)
