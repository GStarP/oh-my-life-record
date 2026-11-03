import { atom } from 'jotai'
import { getCredential } from './credential/credential'
import type { SyncProgress } from './sync/engine.type'
export const credentialAtom = atom(getCredential())
export const credentialModalOpenAtom = atom(false)
export const syncBusyAtom = atom(false)
export const syncProgressAtom = atom<SyncProgress | undefined>(undefined)
