/**
 * 类型模板集合的应用级状态。
 *
 * 模板集合是持久化业务数据，不属于某个页面的挂载周期；记录表单、
 * 模板管理页和同步后的刷新都通过这一份状态交换最新快照。
 */
import { atom } from 'jotai'
import { getDefaultStore } from 'jotai/vanilla'
import type {
  TypeTemplateDataState,
  TypeTemplateDataUpdater,
} from './state.type'

const typeTemplateStore = getDefaultStore()

export const typeTemplateDataAtom = atom<TypeTemplateDataState>({
  templates: [],
  status: 'idle',
})

export function getTypeTemplateData(): TypeTemplateDataState {
  return typeTemplateStore.get(typeTemplateDataAtom)
}

export function updateTypeTemplateData(
  updater: TypeTemplateDataUpdater,
): void {
  typeTemplateStore.set(typeTemplateDataAtom, updater)
}
