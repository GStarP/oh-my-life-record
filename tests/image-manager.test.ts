/** ImageManager 公共 interface：只向调用方暴露可显示来源。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageManager } from '../src/features/records/images/image-manager'
import { InMemoryStorage } from './helpers/inmemory.storage'

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ImageManager：统一图片展示 interface', () => {
  it('从本地暂存加载图片时只暴露可显示 URL，不泄漏 Object URL 生命周期字段', async () => {
    // 列表和编辑器只能依赖稳定的展示契约；ownsUrl、size 等字段必须留在
    // manager 内部，否则未来更换缓存来源会把生命周期逻辑重新散落到 React 层。
    const storage = new InMemoryStorage()
    await storage.putImageBlob('image-1', new Blob(['image']))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image-1')
    const manager = createImageManager({ storage, getCloud: () => undefined })
    const changes: Record<string, unknown>[] = []
    const lease = manager.createLease((sources) => changes.push(sources))

    lease.setImageIds(['image-1'])
    await flushPromises()

    expect(changes.at(-1)).toEqual({
      'image-1': { kind: 'ready', url: 'blob:image-1' },
    })

    lease.release()
  })

  it('云端命名空间变化时同一 imageId 不复用旧的内存资源', async () => {
    // ImageManager 是应用级单例，但用户可以把凭证从测试桶切到生产桶；
    // 两个桶可能恰好使用同一个图片 ID，内存缓存必须重新加载，不能把旧桶
    // 的 Object URL 当成新桶的图片。命名空间变化只替换资源键，不销毁 manager。
    const storage = new InMemoryStorage()
    await storage.putImageBlob('image-1', new Blob(['image']))
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((blob) => `blob:${(blob as Blob).size}`)
    let namespace = 'test-bucket'
    const manager = createImageManager({
      storage,
      getCloud: () => undefined,
      getImageNamespace: () => namespace,
    })
    const changes: Record<string, unknown>[] = []
    const lease = manager.createLease((sources) => changes.push(sources))

    lease.setImageIds(['image-1'])
    await flushPromises()
    expect(createObjectUrl).toHaveBeenCalledTimes(1)

    lease.setImageIds([])
    namespace = 'production-bucket'
    lease.setImageIds(['image-1'])
    await flushPromises()

    expect(createObjectUrl).toHaveBeenCalledTimes(2)
    expect(changes.at(-1)).toEqual({
      'image-1': { kind: 'ready', url: 'blob:5' },
    })
    lease.release()
  })
})
