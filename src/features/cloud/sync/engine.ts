/**
 * SyncEngine：全部同步决策的纯 TS 实现。
 *
 * 这是本仓库唯一的同步测试接缝（见docs/设计文档.md「同步模型」）：引擎不依赖
 * fetch / indexedDB / React 或任何浏览器 API，只通过注入的
 * StorageAdapter（本地）与 CloudAdapter（云端）访问外部世界，
 * 因此可在 Node 环境以内存假实现测试全部同步规则。
 *
 * 规则来源：docs/设计文档.md §5、ADR-0002（云端优先）。
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

/**
 * 对单个月份分类。这是同步决策的核心纯函数。
 *
 * 判定规则（docs/设计文档.md §5.2）：
 * - 云端 > 本地 且 dirty → conflict（云端优先，需确认覆盖）
 * - 云端 > 本地 且 !dirty → download（直接拉取）
 * - 云端 = 本地 且 dirty → upload
 * - 云端 = 本地 且 !dirty → none
 * - 云端 < 本地 → none（防御：本地版本不可能高于云端，出现即视为异常）
 * - 云端无此月 且 dirty → upload（本地新建月的首次上传）
 * - 云端无此月 且 !dirty → none
 */
function classify(
  month: string,
  local: PartitionState | undefined,
  cloudRevision: number | undefined,
): SyncClassification {
  const localRevision = local?.remoteRevision ?? 0
  const dirty = local?.dirty ?? false

  if (cloudRevision !== undefined) {
    if (cloudRevision > localRevision) {
      return { month, kind: dirty ? 'conflict' : 'download' }
    }
    if (cloudRevision === localRevision) {
      return { month, kind: dirty ? 'upload' : 'none' }
    }
    // 云端 < 本地：防御性无操作。
    return { month, kind: 'none' }
  }

  // 云端无此月。
  return { month, kind: dirty ? 'upload' : 'none' }
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
    .map((month) =>
      classify(month, stateByMonth.get(month), manifest.partitions[month]),
    )
}

/** 对全局类型模板集合应用与月份相同的版本/dirty 判定。 */
function classifyTypeTemplates(
  localRemoteRevision: number,
  localDirty: boolean,
  cloudRevision: number | undefined,
): SyncClassification['kind'] {
  if (cloudRevision !== undefined) {
    if (cloudRevision > localRemoteRevision) {
      return localDirty ? 'conflict' : 'download'
    }
    if (cloudRevision === localRemoteRevision) {
      return localDirty ? 'upload' : 'none'
    }
    return 'none'
  }
  return localDirty ? 'upload' : 'none'
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
  const templateKind: SyncKind = classifyTypeTemplates(
    templateState?.remoteRevision ?? 0,
    templateState?.dirty ?? false,
    manifest.typeTemplatesRevision,
  )
  return deriveIndicator(classifyAll(manifest, states), templateKind)
}

/**
 * 完整同步（唯一写入入口，docs/设计文档.md §5.2）。
 *
 * 下载与上传按「月份」粒度同时进行：a 月上传、b 月下载是正常同步，互不干扰；
 * 只有同一个月「云端更高 且 本地 dirty」才是冲突，需确认后以云端覆盖。
 *
 * 顺序：
 * 1. 重读 manifest，逐月分类。
 * 2. 若存在冲突月：先 confirmConflict（取消则整体中止、零变更），
 *    确认后冲突月转为下载（云端覆盖本地）。
 * 3. 下载月与上传月分别执行（可同时）：下载校验失败收集进 brokenMonths，
 *    不覆盖本地、不中止；上传失败则异常上抛。
 * 4. outcome 综合判定：都做 → synced；仅上传 → uploaded；仅下载 → downloaded；
 *    都没做 → already-latest。
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
  const templateKind = classifyTypeTemplates(
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

  // 下载月与上传月同时执行，互不干扰。
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
