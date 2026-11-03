import { describe, expect, it, vi } from 'vitest'
import { sync } from '../src/features/cloud/sync/engine'
import type { BackupState, SyncContext } from '../src/features/cloud/sync/engine.type'
import type { CloudAdapter, CloudSnapshot } from '../src/features/cloud/cloud.type'
import type { DatabaseInfo, ImageFile, StorageAdapter } from '../src/features/storage/type'
import type { NativeFile } from '../src/features/storage/native.type'

const image = (id: string): ImageFile => ({ id, path: `images/${id}.webp`, mime: 'image/webp', bytes: 3, sha256: id.repeat(64) })
function environment() {
  let state: BackupState = { revision: 0, sequence: 0 }
  let local: DatabaseInfo = { sequence: 1, recordCount: 1, images: [image('a'), image('b')] }
  const target: DatabaseInfo = { sequence: 8, recordCount: 4, images: [image('a'), image('b')] }
  let remote: CloudSnapshot | undefined
  const files = new Map<string, NativeFile>(local.images.map((file) => [file.path, file]))
  const objects = new Map<string, number>([['images/a.webp', 3], ['images/extra.webp', 3]])
  const events: string[] = []
  const context: SyncContext = {
    begin: vi.fn(async () => { events.push('begin') }), end: vi.fn(async () => { events.push('end') }),
    prepare: vi.fn(async () => {}),
    loadState: async () => structuredClone(state),
    saveState: async (_, value) => { state = structuredClone(value) },
    snapshot: async () => ({ path: 'transfers/test/database.sqlite', bytes: 42, sha256: 'd'.repeat(64) }),
    info: async (path) => files.get(path),
    freeSpace: async () => 1024 ** 3,
    activate: vi.fn(async (_, path, __, ___, receipt) => { events.push('activate'); local = target; files.delete(path); state = receipt }),
    adoptImage: vi.fn(async () => {}), align: vi.fn(async () => { events.push('align') }),
    confirmConflict: vi.fn(async () => true), progress: vi.fn(), observe: async () => async () => {},
  }
  const cloud: CloudAdapter = {
    namespace: 'test', getSnapshot: async () => remote,
    listImages: async () => [...objects].map(([path, bytes]) => ({ path, bytes })),
    uploadImage: vi.fn(async (path) => { events.push('upload:' + path); objects.set(path, 3) }),
    uploadSnapshot: vi.fn(async (file, revision) => { events.push('snapshot'); remote = { ...file, revision, etag: 'etag-' + revision } }),
    download: vi.fn(async (key, path, sha256) => { const file = { path, sha256, bytes: key === 'database.sqlite' ? 42 : 3 }; files.set(path, file); return file }),
    deleteImage: vi.fn(async (path) => { events.push('delete:' + path); objects.delete(path) }),
  }
  const storage = { inspect: async (path?: string) => path ? target : local, getTypeTemplates: async () => [] } as unknown as StorageAdapter
  return { context, cloud, storage, files, objects, events, setRemote: (value: CloudSnapshot) => { remote = value }, setState: (value: BackupState) => { state = value }, getState: () => state, setLocal: (value: DatabaseInfo) => { local = value }, target }
}

describe('数据库快照同步', () => {
  it('阶段展示尚未就绪时不开始该阶段的操作', async () => {
    // 界面需要为快速步骤保留最短阅读时间。同步必须等待阶段通知完成，
    // 否则多个步骤仍会在同一帧覆盖状态文字；传输数量更新无需逐个等待。
    // 在提交阶段拦住通知，预期云端快照尚未写入，放行后才完成备份。
    const env = environment()
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const ready = new Promise<void>((resolve) => { entered = resolve })
    env.context.progress = async (progress) => {
      if (progress.stage === '提交数据库快照') { entered(); await gate }
    }
    const work = sync(env)
    try {
      await ready
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(env.cloud.uploadSnapshot).not.toHaveBeenCalled()
    } finally { release(); await work }
    expect(env.cloud.uploadSnapshot).toHaveBeenCalledTimes(1)
  })
  it('仅传缺失图片，快照提交成功后才传播删除', async () => {
    // 云端已有 a，缺少 b，另有多余文件。删除必须在完整快照提交之后，
    // 否则备份提交失败会破坏仍有效的云端快照；已完成图片也不应重复传输。
    const env = environment()
    await expect(sync(env)).resolves.toBe('uploaded')
    expect(env.cloud.uploadImage).toHaveBeenCalledTimes(1)
    expect(env.cloud.uploadImage).toHaveBeenCalledWith('images/b.webp', 'image/webp', expect.any(String))
    expect(env.events.indexOf('snapshot')).toBeLessThan(env.events.indexOf('delete:images/extra.webp'))
    expect(env.getState()).toEqual({ revision: 1, sequence: 1, sha256: 'd'.repeat(64) })
    expect(env.events.at(-1)).toBe('end')
  })
  it('提交回包丢失时保留回执，下次核对成功后只完成剩余对齐', async () => {
    // 模拟对象已提交，但客户端只收到网络错误。此时不能报告成功，也不能提前删除图片。
    // 再次手动同步应通过摘要和版本识别自己的提交，避免误报双端冲突或重复上传数据库。
    const env = environment()
    const upload = env.cloud.uploadSnapshot
    env.cloud.uploadSnapshot = vi.fn(async (file, revision, etag, id) => { await upload(file, revision, etag, id); throw new Error('响应丢失') })
    await expect(sync(env)).rejects.toThrow('响应丢失')
    expect(env.getState().pending).toBeDefined()
    expect(env.objects.has('images/extra.webp')).toBe(true)
    expect(env.events.at(-1)).toBe('end')
    await expect(sync(env)).resolves.toBe('already-latest')
    expect(env.cloud.uploadSnapshot).toHaveBeenCalledTimes(1)
    expect(env.context.confirmConflict).not.toHaveBeenCalled()
    expect(env.objects.has('images/extra.webp')).toBe(false)
    expect(env.getState().pending).toBeUndefined()
  })
  it('恢复中断保留当前数据，下次复用完整文件并在最后安装数据库', async () => {
    // 第一次下载图片失败，当前可用数据库不得替换。第二次重试只补缺失文件，
    // 完整数据库快照由工作目录复用；所有图片齐全后才原子安装，并保存恢复回执。
    const env = environment()
    env.setState({ revision: 1, sequence: 1, sha256: 'd'.repeat(64) })
    env.setRemote({ revision: 2, bytes: 42, sha256: 'c'.repeat(64), etag: 'remote-2' })
    env.files.delete('images/b.webp')
    env.objects.set('images/b.webp', 3)
    const download = env.cloud.download
    env.cloud.download = vi.fn(async (key, path, sha, id, etag) => {
      if (key === 'images/b.webp') throw new Error('网络中断')
      return download(key, path, sha, id, etag)
    })
    await expect(sync(env)).rejects.toThrow('网络中断')
    expect(env.context.activate).not.toHaveBeenCalled()
    expect(env.getState().revision).toBe(1)
    env.cloud.download = vi.fn((key, path, sha, id, etag) => download(key, path, sha, id, etag))
    await expect(sync(env)).resolves.toBe('downloaded')
    expect(env.cloud.download).toHaveBeenCalledTimes(1)
    expect(env.cloud.download).toHaveBeenCalledWith('images/b.webp', expect.stringContaining('/images/b.webp'), 'b'.repeat(64), expect.any(String))
    expect(env.getState()).toEqual({ revision: 2, sequence: 8, sha256: 'c'.repeat(64) })
    expect(env.context.activate).toHaveBeenCalledTimes(1)
  })
  it('双端修改取消后不进入执行阶段；恢复空间不足也不替换数据', async () => {
    // 冲突确认是执行前唯一的取消入口。拒绝覆盖必须零写入。
    // 同意之后仍要预估缺失文件空间；空间不足时释放会话并保持数据库可用。
    const env = environment()
    env.setRemote({ revision: 2, bytes: 42, sha256: 'c'.repeat(64), etag: 'remote-2' })
    env.context.confirmConflict = async () => false
    await expect(sync(env)).resolves.toBe('aborted')
    expect(env.context.begin).not.toHaveBeenCalled()
    env.context.confirmConflict = async () => true
    env.context.freeSpace = async () => 0
    await expect(sync(env)).rejects.toThrow('空间不足')
    expect(env.context.activate).not.toHaveBeenCalled()
    expect(env.events.at(-1)).toBe('end')
  })
})

it('安装中断后，校验并复用已经移入本体目录、尚未被当前数据库引用的图片', async () => {
  // 文件移动和数据库替换之间可能退出。此时本体已经完整落盘，但当前数据库还没有它的元信息。
  // 下一次恢复应核对 SHA 后复用，避免把同一批 GB 图片重新下载一份。
  const env = environment()
  env.setState({ revision: 1, sequence: 1, sha256: 'd'.repeat(64) })
  env.setLocal({ sequence: 1, recordCount: 1, images: [] })
  env.objects.set('images/b.webp', 3)
  env.setRemote({ revision: 2, bytes: 42, sha256: 'c'.repeat(64), etag: 'remote-2' })
  await expect(sync(env)).resolves.toBe('downloaded')
  expect(env.cloud.download).toHaveBeenCalledTimes(1)
  expect(env.cloud.download).toHaveBeenCalledWith('database.sqlite', expect.any(String), 'c'.repeat(64), expect.any(String), 'remote-2')
})
