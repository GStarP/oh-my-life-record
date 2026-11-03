import type { ImageFile } from '../../storage/type'
import type { BackupState, SyncDependencies, SyncOutcome, TransferFile } from './engine.type'

const RESERVE_BYTES = 16 * 1024 * 1024

/** 先补图片、再提交快照、最后传播删除；未确认结果留待下次核对。 */
export async function sync({ storage, cloud, context }: SyncDependencies): Promise<SyncOutcome> {
  const id = crypto.randomUUID()
  let started = false
  let detach: (() => Promise<void>) | undefined
  let state: BackupState = await context.loadState(cloud.namespace)
  const show = (stage: string) => context.progress({ stage, files: 0, totalFiles: 0, bytes: 0, totalBytes: 0 })
  async function transfer<T extends TransferFile>(images: T[], stage: string, action: (image: T) => Promise<void>) {
    if (images.length === 0) return
    let failed: unknown
    let next = 0, completed = 0, completedBytes = 0
    const bytes = new Map<string, number>()
    const done = new Set<string>()
    const totalBytes = images.reduce((sum, image) => sum + image.bytes, 0)
    const report = () => context.progress({ stage, files: completed, totalFiles: images.length, bytes: completedBytes + [...bytes.values()].reduce((sum, value) => sum + value, 0), totalBytes })
    detach = await context.observe(id, (key, value) => { if (!done.has(key)) { bytes.set(key, value); report() } })
    await report()
    try {
      await Promise.all(Array.from({ length: Math.min(2, images.length) }, async () => {
        while (next < images.length && !failed) {
          const image = images[next++]
          try { await action(image) } catch (error) { failed = error; return }
          done.add(image.path); bytes.delete(image.path); completed++; completedBytes += image.bytes; await report()
        }
      }))
      if (failed) throw failed
    } finally { await detach(); detach = undefined }
  }
  async function verifyImages(images: ImageFile[]) {
    const actual = await cloud.listImages(id)
    const expected = new Map(images.map((image) => [image.path, image.bytes]))
    if (actual.length !== expected.size || actual.some((image) => expected.get(image.path) !== image.bytes)) throw new Error('云端图片集合尚未对齐，请重新同步')
  }
  try {
    await show('检查云端')
    const remote = await cloud.getSnapshot()
    const objects = await cloud.listImages()
    let local = await storage.inspect()
    if (state.pending && remote?.sha256 === state.pending.sha256 && remote.revision === state.pending.revision) {
      state = { revision: remote.revision, sequence: state.pending.sequence, sha256: remote.sha256 }
      await context.saveState(cloud.namespace, state)
    }
    if ((!remote && state.revision > 0) || (remote && remote.revision < state.revision)) throw new Error('云端版本异常，本地数据保持不变')
    if (remote && remote.revision === state.revision && remote.sha256 !== state.sha256) throw new Error('云端版本与内容不一致，本地数据保持不变')
    if (!remote && local.recordCount === 0 && local.images.length === 0 && local.sequence === 0 && objects.length > 0) throw new Error('云端尚无完整数据库，请先完成完整备份后再试')
    const dirty = local.sequence !== state.sequence
    const checkedSequence = local.sequence
    const download = remote !== undefined && remote.revision > state.revision
    if (download && dirty && !await context.confirmConflict()) return 'aborted'
    await context.begin(id); started = true
    local = await storage.inspect()
    if (local.sequence !== checkedSequence) throw new Error('检查期间本地发生修改，请重新同步')
    if (download && remote) {
      await context.prepare(id, remote.sha256)
      await show('获取数据库快照')
      const folder = 'transfers/' + remote.sha256
      const path = folder + '/database.sqlite'
      const existing = await context.info(path)
      if (existing?.bytes !== remote.bytes) {
        if (await context.freeSpace() < remote.bytes + RESERVE_BYTES) throw new Error('存储空间不足，无法恢复数据库')
        await cloud.download('database.sqlite', path, remote.sha256, id, remote.etag)
      }
      const target = await storage.inspect(path)
      const cloudImages = new Map(objects.map((image) => [image.path, image.bytes]))
      if (target.images.some((image) => cloudImages.get(image.path) !== image.bytes)) throw new Error('云端数据库引用的图片缺失或大小不一致，本地数据保持不变')
      const localByPath = new Map(local.images.map((image) => [image.path, image]))
      const missing: ImageFile[] = []
      for (const image of target.images) {
        const current = localByPath.get(image.path)
        if (current && current.sha256 !== image.sha256) throw new Error('相同图片标识的内容发生变化')
        const onDisk = await context.info(image.path)
        if (current?.sha256 === image.sha256 && onDisk?.bytes === image.bytes) continue
        if (!current && onDisk?.bytes === image.bytes && (await context.info(image.path, true))?.sha256 === image.sha256) continue
        if ((await context.info(folder + '/' + image.path))?.bytes !== image.bytes) missing.push(image)
      }
      if (await context.freeSpace() < missing.reduce((sum, image) => sum + image.bytes, 0) + RESERVE_BYTES) throw new Error('存储空间不足，现有数据保持不变')
      await transfer(missing, '恢复图片', async (image) => { await cloud.download(image.path, folder + '/' + image.path, image.sha256, id) })
      await show('校验并安装数据')
      if ((await cloud.getSnapshot(id))?.etag !== remote.etag) throw new Error('恢复期间云端发生变化，请重试')
      state = { revision: remote.revision, sequence: target.sequence, sha256: remote.sha256 }
      await context.activate(id, path, target.images.map((image) => image.path), cloud.namespace, state)
      const expected = new Set(target.images.map((image) => image.path))
      await show('对齐图片集合')
      await transfer(objects.filter((image) => !expected.has(image.path)), '删除多余云端图片', (image) => cloud.deleteImage(image.path, id))
      await verifyImages(target.images)
      return 'downloaded'
    }
    await context.prepare(id, id)
    const remoteByPath = new Map(objects.map((image) => [image.path, image.bytes]))
    const uploads: ImageFile[] = []
    await show('检查本地图片')
    let checked = 0
    for (const image of local.images) {
      if (!/^images\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(image.path) || !/^[a-f0-9]{64}$/.test(image.sha256)) throw new Error('本地图片元信息不正确')
      const onDisk = await context.info(image.path)
      if (onDisk?.bytes !== image.bytes) {
        if (remote && remoteByPath.get(image.path) === image.bytes) {
          const repaired = await cloud.download(image.path, 'transfers/' + id + '/' + image.path, image.sha256, id)
          await context.adoptImage(id, repaired.path, image.path)
        } else {
          throw new Error('本地图片缺失或损坏，云端没有可恢复副本')
        }
      }
      if (remoteByPath.get(image.path) !== image.bytes) uploads.push(image)
      checked++
      if (checked % 25 === 0 || checked === local.images.length) await context.progress({ stage: '检查本地图片', files: checked, totalFiles: local.images.length, bytes: 0, totalBytes: 0 })
    }
    await transfer(uploads, '上传图片', (image) => cloud.uploadImage(image.path, image.mime, id))
    let uploaded = false
    if (dirty || (!remote && (local.recordCount > 0 || (await storage.getTypeTemplates()).length > 0))) {
      await show('提交数据库快照')
      const file = await context.snapshot(id)
      const revision = (remote?.revision ?? 0) + 1
      await context.saveState(cloud.namespace, { ...state, pending: { revision, sequence: local.sequence, sha256: file.sha256 } })
      await cloud.uploadSnapshot(file, revision, remote?.etag, id)
      state = { revision, sequence: local.sequence, sha256: file.sha256 }
      await context.saveState(cloud.namespace, state)
      uploaded = true
    }
    await show('对齐图片集合')
    const expected = new Set(local.images.map((image) => image.path))
    await transfer(objects.filter((image) => !expected.has(image.path)), '删除多余云端图片', (image) => cloud.deleteImage(image.path, id))
    await context.align(id, [...expected])
    await verifyImages(local.images)
    return uploaded ? 'uploaded' : 'already-latest'
  } finally {
    if (detach) await detach().catch(() => {})
    if (started) await context.end(id)
  }
}
