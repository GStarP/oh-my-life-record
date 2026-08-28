/**
 * 外部世界单例（与 React 无关，见 docs/设计文档.md「UI 壳与设置页」）。
 * StorageAdapter 与应用同生命周期；R2 适配器随凭证变化重建（currentCloud）。
 */
import { IndexedDbStorage } from '../features/storage/indexeddb'
import { R2CloudAdapter } from '../features/cloud/r2/r2'
import type { R2Config } from '../features/cloud/cloud.type'
import {
  cloudResourceNamespace,
  getCredential,
  hasCredential,
} from '../features/cloud/credential/credential'
import { createImageManager } from '../features/records/images/image-manager'
import { clearImageCache } from '../features/records/images/image-pipeline'
import type { ImageManager } from '../features/records/images/image-manager.type'

/** 本地存储单例（生产数据库名）。 */
export const storage = new IndexedDbStorage('omlr')

/** 清空云端、本机数据及图片缓存；可重复执行，完成后由设置页刷新。 */
export async function clearAllData(config: R2Config): Promise<void> {
  await new R2CloudAdapter(config).clearAllData()
  await clearImageCache()
  await storage.clearAllData()
}

let cachedCredential: R2Config | undefined
let cachedCloud: R2CloudAdapter | undefined

function sameCredential(left: R2Config | undefined, right: R2Config): boolean {
  return Boolean(
    left &&
    left.endpoint === right.endpoint &&
    left.bucket === right.bucket &&
    left.accessKeyId === right.accessKeyId &&
    left.accessKeySecret === right.accessKeySecret,
  )
}

/**
 * 按当前凭证取得 R2 适配器；凭证未变化时复用同一个实例，凭证变化时重建。
 * 无完整凭证返回 undefined（调用方应提示用户完成云端配置）。
 */
export function currentCloud(): R2CloudAdapter | undefined {
  const credential = getCredential()
  if (!credential || !hasCredential(credential)) {
    cachedCredential = undefined
    cachedCloud = undefined
    return undefined
  }
  if (!cachedCloud || !sameCredential(cachedCredential, credential)) {
    cachedCredential = credential
    cachedCloud = new R2CloudAdapter(credential)
  }
  return cachedCloud
}

/**
 * 应用生命周期内唯一的图片管理器。
 *
 * ImageManager 本身不依赖 React；React 组件只通过 lease 使用它。把实例
 * 放在 runtime 之后，记录页切换、编辑器开关都不会丢失图片资源缓存。
 */
export const imageManager: ImageManager = createImageManager({
  storage,
  getCloud: currentCloud,
  getImageNamespace: () => cloudResourceNamespace(getCredential()),
})
