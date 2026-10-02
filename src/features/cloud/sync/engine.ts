/**
 * 云端同步规则：通过注入的本地存储和云端接口执行，不依赖浏览器或 React。
 * 规则来源：docs/设计文档.md §5、ADR-0002。
 */
import { SCHEMA_VERSION } from '../r2/schema'
import type {
  Manifest,
  PartitionFile,
  PartitionState,
} from './engine.type'
import type { StorageAdapter } from '../../storage/type'
import type { CloudAdapter } from '../cloud.type'
import type {
  ConfirmConflict,
  PendingImage,
  SyncClassification,
  SyncIndicator,
  SyncReport,
  SyncKind,
} from './engine.type'

/** 云端从未初始化时视为空 manifest。 */
const EMPTY_MANIFEST: Manifest = {
  schemaVersion: SCHEMA_VERSION,
  partitions: {},
  typeTemplatesRevision: 0,
}

/** 分片与模板共用版本判定；云端低于本地已确认值时保持不读写。 */
function classifyRevision(
  localRevision: number,
  dirty: boolean,
  cloudRevision: number | undefined,
): SyncKind {
  if (cloudRevision !== undefined) {
    if (cloudRevision > localRevision) {
      return dirty ? 'conflict' : 'download'
    }
    if (cloudRevision === localRevision) {
      return dirty ? 'upload' : 'none'
    }
    return 'none'
  }
  return dirty ? 'upload' : 'none'
}

/** 对「云端 ∪ 本地」所有月份分类，按月份升序返回。 */
function classifyAll(
  manifest: Manifest,
  states: PartitionState[],
): SyncClassification[] {
  const months = new Set<string>(Object.keys(manifest.partitions))
  const stateByMonth = new Map(states.map((s) => [s.month, s]))
  for (const s of states) months.add(s.month)

  return [...months]
    .sort()
    .map((month) => {
      const local = stateByMonth.get(month)
      return {
        month,
        kind: classifyRevision(
          local?.remoteRevision ?? 0,
          local?.dirty ?? false,
          manifest.partitions[month],
        ),
      }
    })
}

/**
 * 由月份分类推导指示器（docs/设计文档.md §5.5）。
 * 两个独立维度：有下载/冲突月 → 亮 ↓；有上传月 → 亮 ↑；可同时成立。
 */
function deriveIndicator(
  classes: SyncClassification[],
  typeTemplatesKind: SyncKind = 'none',
): SyncIndicator {
  const hasDownload = classes.some(
    (c) => c.kind === 'download' || c.kind === 'conflict',
  ) || typeTemplatesKind === 'download' || typeTemplatesKind === 'conflict'
  const hasUpload = classes.some((c) => c.kind === 'upload') || typeTemplatesKind === 'upload'
  if (hasDownload && hasUpload) return 'both'
  if (hasDownload) return 'download'
  if (hasUpload) return 'upload'
  return 'none'
}

/**
 * 只读检查：启动/回前台时推导同步按钮指示器。
 * 只对比版本，不下载、不上传、不修改任何本地或云端数据。
 */
export async function checkForUpdates(
  storage: StorageAdapter,
  cloud: CloudAdapter,
): Promise<SyncIndicator> {
  const manifest = (await cloud.getManifest()) ?? EMPTY_MANIFEST
  const states = await storage.getAllPartitionStates()
  const templateState = await storage.getTypeTemplateState()
  const templateKind = classifyRevision(
    templateState?.remoteRevision ?? 0,
    templateState?.dirty ?? false,
    manifest.typeTemplatesRevision,
  )
  return deriveIndicator(classifyAll(manifest, states), templateKind)
}

/**
 * 记录与模板快照的全局同步入口（docs/设计文档.md §5.2）。
 * 冲突取消时整体中止；确认后先下载再上传。损坏文件保留本地数据并在
 * 返回值中报告，其余请求或写入错误向调用方传播。
 */
export async function sync(
  storage: StorageAdapter,
  cloud: CloudAdapter,
  confirmConflict: ConfirmConflict,
): Promise<SyncReport> {
  const manifest = (await cloud.getManifest()) ?? EMPTY_MANIFEST
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`不支持的 schemaVersion：${manifest.schemaVersion}`)
  }

  const classes = classifyAll(manifest, await storage.getAllPartitionStates())
  const templateState = await storage.getTypeTemplateState()
  const templateKind = classifyRevision(
    templateState?.remoteRevision ?? 0,
    templateState?.dirty ?? false,
    manifest.typeTemplatesRevision,
  )
  const conflicts = classes.filter((c) => c.kind === 'conflict')
  const downloads = classes.filter((c) => c.kind === 'download')
  const uploads = classes.filter((c) => c.kind === 'upload')
  const templateConflict = templateKind === 'conflict'
  const templateDownload = templateConflict || templateKind === 'download'
  const templateUpload = templateKind === 'upload'

  // 冲突一票否决（ADR-0002）：取消则整体中止、零变更。
  if (conflicts.length > 0 || templateConflict) {
    const confirmed = await confirmConflict(
      conflicts.map((c) => c.month),
      templateConflict,
    )
    if (!confirmed) return { outcome: 'aborted', brokenMonths: [] }
    // 确认后冲突月转为下载（云端覆盖本地）。
    downloads.push(...conflicts)
  }

  // 同一次同步允许不同月份分别下载或上传；先下载，再上传。
  const { brokenMonths, brokenTypeTemplates, didDownload } = await downloadPhase(
    storage,
    cloud,
    downloads,
    templateDownload,
    manifest,
  )
  let didUpload = false
  if (uploads.length > 0 || templateUpload) {
    await uploadPhase(storage, cloud, uploads, templateUpload, manifest)
    didUpload = true
  }

  const outcome: SyncReport['outcome'] =
    didUpload && didDownload
      ? 'synced'
      : didUpload
        ? 'uploaded'
        : didDownload
          ? 'downloaded'
          : 'already-latest'
  return {
    outcome,
    brokenMonths,
    ...(brokenTypeTemplates ? { brokenTypeTemplates: true } : {}),
  }
}

/** 下载阶段：逐月下载记录与全局模板；文件缺失收集进 broken 状态。 */
async function downloadPhase(
  storage: StorageAdapter,
  cloud: CloudAdapter,
  downloads: SyncClassification[],
  templateDownload: boolean,
  manifest: Manifest,
): Promise<{
  brokenMonths: string[]
  brokenTypeTemplates: boolean
  didDownload: boolean
}> {
  const brokenMonths: string[] = []
  let brokenTypeTemplates = false
  let didDownload = false
  for (const d of downloads) {
    const file = await cloud.getPartitionFile(d.month)
    // manifest 是本次同步的版本快照；文件 revision 不一致时不能把
    // 一个未被 manifest 提交的快照写入本地，否则下一次检查可能把本地
    // 错误地视为“领先”或反复覆盖。
    if (!file || file.revision !== manifest.partitions[d.month]) {
      brokenMonths.push(d.month)
      continue
    }
    await storage.replacePartition(file)
    didDownload = true
  }
  if (templateDownload) {
    const file = await cloud.getTypeTemplatesFile()
    if (!file || file.revision !== manifest.typeTemplatesRevision) {
      brokenTypeTemplates = true
    } else {
      await storage.replaceTypeTemplates(file.templates, file.revision)
      didDownload = true
    }
  }
  return { brokenMonths, brokenTypeTemplates, didDownload }
}

/**
 * 上传阶段：传图 → 写记录/模板文件 → PUT manifest（提交点）→ 复位本地状态。
 * 类型模板是独立的全局文件，但与记录分片共用 manifest 提交点。
 */
async function uploadPhase(
  storage: StorageAdapter,
  cloud: CloudAdapter,
  uploads: SyncClassification[],
  templateUpload: boolean,
  manifest: Manifest,
): Promise<void> {
  // 1. 读取各上传月的记录，并收集被引用的图片 ID（去重）。
  const recordsByMonth = new Map<string, PartitionFile['records']>()
  const referencedImageIds = new Set<string>()
  for (const u of uploads) {
    const records = await storage.getRecordsInMonth(u.month)
    recordsByMonth.set(u.month, records)
    for (const r of records) for (const img of r.images) referencedImageIds.add(img)
  }

  // 2. 计算待上传图片：仅「被本地记录引用 且 本地暂存存在（即尚未上传）」。
  //    存在即未上传（ADR-0005：上传成功后删除本地暂存），孤儿（有暂存无引用）
  //    不上传——从源头预防云端孤儿。
  const pendingImages: PendingImage[] = []
  for (const id of referencedImageIds) {
    const blob = await storage.getImageBlob(id)
    if (blob) pendingImages.push({ id, blob })
  }

  // 3. 传图；成功后删除本地暂存（putImage 幂等，可安全重试）。
  for (const img of pendingImages) {
    await cloud.putImage(img.id, img.blob)
    await storage.deleteImageBlob(img.id)
  }

  // 4. 写各 dirty 月 JSON（分片版本 = 云端旧值 + 1）。
  const newPartitions = { ...manifest.partitions }
  for (const u of uploads) {
    const newRevision = (manifest.partitions[u.month] ?? 0) + 1
    await cloud.putPartitionFile({
      month: u.month,
      revision: newRevision,
      records: recordsByMonth.get(u.month) ?? [],
    })
    newPartitions[u.month] = newRevision
  }

  let newTypeTemplatesRevision = manifest.typeTemplatesRevision
  if (templateUpload) {
    newTypeTemplatesRevision = manifest.typeTemplatesRevision + 1
    await cloud.putTypeTemplatesFile({
      revision: newTypeTemplatesRevision,
      templates: await storage.getTypeTemplates(),
    })
  }

  // 5. PUT manifest（提交点）：此步失败则异常向上传播，本地 dirty 不复位，
  //    下次 sync 重读旧 manifest 后幂等重写月份文件与 manifest，自愈。
  await cloud.putManifest({
    schemaVersion: SCHEMA_VERSION,
    partitions: newPartitions,
    typeTemplatesRevision: newTypeTemplatesRevision,
  })

  // 6. 复位本地同步状态。
  for (const u of uploads) {
    await storage.putPartitionState({
      month: u.month,
      remoteRevision: newPartitions[u.month],
      dirty: false,
    })
  }
  if (templateUpload) {
    await storage.putTypeTemplateState({
      remoteRevision: newTypeTemplatesRevision,
      dirty: false,
    })
  }
}
