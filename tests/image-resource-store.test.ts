/** 页面内图片资源 module：可见租约共享与 LRU 淘汰。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageResourceStore } from '../src/features/records/images/image-resource-store'
import type { ImageSource } from '../src/features/records/images/image-pipeline.type'

function ready(url: string, size: number): ImageSource {
  return { kind: 'ready', url, ownsUrl: true, size }
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('image resource store：可见图片优先的资源共享', () => {
  it('列表和编辑表单共享同一个加载任务与 Object URL，最后一个租约释放后仍可命中内存缓存', async () => {
    // 同一条记录同时出现在列表和编辑表单时，只允许一次加载；
    // 列表离开后编辑表单仍在使用，因此不能提前释放或替换图片资源。
    let resolveImage!: (source: ImageSource) => void
    const pending = new Promise<ImageSource>((resolve) => {
      resolveImage = resolve
    })
    const loader = vi.fn(() => pending)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const store = createImageResourceStore(loader, { maxBytes: 100 })
    const listChanges: Record<string, ImageSource>[] = []
    const editorChanges: Record<string, ImageSource>[] = []
    const list = store.createLease((sources) => listChanges.push(sources))
    const editor = store.createLease((sources) => editorChanges.push(sources))

    list.setImageIds(['image-a'])
    editor.setImageIds(['image-a'])
    expect(loader).toHaveBeenCalledTimes(1)

    const source = ready('blob:image-a', 60)
    resolveImage(source)
    await flushPromises()

    expect(listChanges.at(-1)?.['image-a']).toBe(source)
    expect(editorChanges.at(-1)?.['image-a']).toBe(source)
    list.release()
    expect(revoke).not.toHaveBeenCalled()
    editor.release()
    expect(revoke).not.toHaveBeenCalled()

    const reopenedChanges: Record<string, ImageSource>[] = []
    const reopened = store.createLease((sources) => reopenedChanges.push(sources))
    reopened.setImageIds(['image-a'])
    expect(loader).toHaveBeenCalledTimes(1)
    expect(reopenedChanges.at(-1)?.['image-a']).toBe(source)

    reopened.release()
    store.dispose()
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:image-a')
  })

  it('只淘汰超过容量后最久未使用的不可见图片，不淘汰仍在显示的图片', async () => {
    // 内存缓存超限时，当前可见图片必须保持可用；只有已经没有任何租约的旧图片
    // 才能被释放，避免用户正在看的图片因为缓存整理突然变成空白。
    const sources = new Map([
      ['image-a', ready('blob:image-a', 60)],
      ['image-b', ready('blob:image-b', 60)],
    ])
    const loader = vi.fn(async (id: string) => sources.get(id)!)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const store = createImageResourceStore(loader, { maxBytes: 100 })
    const first = store.createLease(() => {})
    const second = store.createLease(() => {})

    first.setImageIds(['image-a'])
    await flushPromises()
    first.release()
    second.setImageIds(['image-b'])
    await flushPromises()

    expect(revoke).toHaveBeenCalledWith('blob:image-a')
    expect(revoke).not.toHaveBeenCalledWith('blob:image-b')

    second.release()
    store.dispose()
    expect(revoke).toHaveBeenCalledWith('blob:image-b')
  })

  it('不可见图片完成后进入 LRU；带签名的直链不进入空闲内存缓存', async () => {
    // 图片在请求完成前离开可见位置时，Blob 仍可进入有上限的 LRU，供用户快速切回；
    // 但直链包含短期签名参数，不能在用户稍后切屏回来时复用可能已经过期的地址。
    let resolveImage!: (source: ImageSource) => void
    const pending = new Promise<ImageSource>((resolve) => {
      resolveImage = resolve
    })
    const loader = vi.fn(() => pending)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const store = createImageResourceStore(loader)
    const changes: Record<string, ImageSource>[] = []
    const lease = store.createLease((sources) => changes.push(sources))

    lease.setImageIds(['image-a'])
    lease.setImageIds([])
    resolveImage(ready('blob:image-a', 20))
    await flushPromises()

    expect(changes.at(-1)).toEqual({})
    expect(revoke).not.toHaveBeenCalled()

    const reopened = store.createLease(() => {})
    reopened.setImageIds(['image-a'])
    expect(loader).toHaveBeenCalledTimes(1)
    reopened.release()
    store.dispose()
    expect(revoke).toHaveBeenCalledWith('blob:image-a')

    const directSource: ImageSource = {
      kind: 'ready',
      url: 'https://example.test/image-a?signature=short-lived',
      ownsUrl: false,
    }
    const directLoader = vi.fn(async () => directSource)
    const directStore = createImageResourceStore(directLoader)
    const directLease = directStore.createLease(() => {})
    directLease.setImageIds(['image-a'])
    await flushPromises()
    directLease.release()

    const directReopened = directStore.createLease(() => {})
    directReopened.setImageIds(['image-a'])
    await flushPromises()
    expect(directLoader).toHaveBeenCalledTimes(2)

    directStore.dispose()
    lease.release()
    directReopened.release()
  })
})
