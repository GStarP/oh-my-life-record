/**
 * 记录页：按月加载、按天分组、虚拟滚动与记录编辑入口。
 *
 * 页面只编排状态和组件；记录写入/删除通过 record workflow 完成，全局同步
 * 通过 sync engine 完成。页面不直接修改 partitionState。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Box,
  Button,
  Flex,
  Icon,
  Input,
  InputGroup,
  Spinner,
  Text,
} from '@chakra-ui/react'
import {
  LuArrowDownUp,
  LuCloudDownload,
  LuCloudUpload,
  LuPlus,
  LuRefreshCw,
  LuSearch,
} from 'react-icons/lu'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { currentCloud, imageManager, storage } from '../runtime'
import {
  cloudBlockedAtom,
  configuredAtom,
  onlineAtom,
  syncBusyAtom,
} from '../../features/cloud/state'
import {
  BrokenMonthsDialog,
  ConflictDialog,
} from '../../features/cloud/sync/dialog'
import type {
  ConflictDialogState,
  ConflictItem,
} from '../../features/cloud/sync/dialog.type'
import { sync as syncCloud } from '../../features/cloud/sync/engine'
import { toaster } from '../../features/notifications/toaster'
import {
  getSyncIndicator,
  refreshSyncIndicator as refreshSharedSyncIndicator,
  subscribeSyncIndicator,
} from '../sync-indicator'
import { cleanupLocalOrphanImages, stageImageFiles } from '../../features/records/images/image-staging'
import { loadInitialRecords, loadOlderRecords } from '../../features/records/list/record-data'
import {
  getRecordData,
  recordDataAtom,
  updateRecordData,
} from '../../features/records/list/record-data-state'
import { filterRecordsByType, groupRecordsByDay } from '../../features/records/list/record-list'
import { RecordCard, RecordDayHeader } from '../../features/records/list/record-card'
import { RecordEditor } from '../../features/records/editor/record-editor'
import { createRecordWorkflow } from '../../features/records/record-workflow'
import { TypeTemplatePicker } from '../../features/type-templates/template-picker'
import {
  typeTemplateDataAtom,
  updateTypeTemplateData,
} from '../../features/type-templates/state'
import { createTypeTemplateWorkflow } from '../../features/type-templates/workflow'
import type { TypeTemplateWorkflow } from '../../features/type-templates/workflow.type'
import { previousMonth } from '../../utils/time'
import type { LifeRecord } from '../../features/records/type'
import type { RecordTypeTemplate } from '../../features/type-templates/type'
import type { RecordListItem } from '../../features/records/list/record-list.type'
import type { SyncIndicator } from '../../features/cloud/sync/engine.type'

function sortRecords(records: Iterable<LifeRecord>): LifeRecord[] {
  return [...records].sort(
    (left, right) =>
      right.time.getTime() - left.time.getTime() || right.id.localeCompare(left.id),
  )
}

function mergeRecords(current: LifeRecord[], incoming: LifeRecord[]): LifeRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]))
  for (const record of incoming) byId.set(record.id, record)
  return sortRecords(byId.values())
}

function flattenGroups(items: ReturnType<typeof groupRecordsByDay>): RecordListItem[] {
  const flattened: RecordListItem[] = []
  for (const group of items) {
    flattened.push({ kind: 'day', group })
    for (const record of group.records) flattened.push({ kind: 'record', record })
  }
  return flattened
}

function syncStatusView(indicator: SyncIndicator) {
  switch (indicator) {
    case 'upload':
      return { icon: LuCloudUpload, label: '待上传' }
    case 'download':
      return { icon: LuCloudDownload, label: '有更新' }
    case 'both':
      return { icon: LuArrowDownUp, label: '需同步' }
    default:
      return { icon: LuRefreshCw, label: '已同步' }
  }
}

export function RecordsPage() {
  const recordData = useAtomValue(recordDataAtom)
  const typeTemplates = useAtomValue(typeTemplateDataAtom).templates
  const { records, nextMonth } = recordData
  const initialLoading =
    recordData.initialStatus === 'idle' || recordData.initialStatus === 'loading'
  const loadError =
    recordData.initialStatus === 'error' ? recordData.initialError : undefined
  const olderLoading = recordData.olderStatus === 'loading'
  const olderLoadError =
    recordData.olderStatus === 'error' ? recordData.olderError : undefined
  const [filterInput, setFilterInput] = useState('')
  const [filter, setFilter] = useState('')
  const [syncBusy, setSyncBusy] = useAtom(syncBusyAtom)
  const [syncCheckIndicator, setSyncCheckIndicator] = useState<SyncIndicator>()
  const isOnline = useAtomValue(onlineAtom)
  const [conflictDialog, setConflictDialog] = useState<ConflictDialogState>()
  const [brokenMonths, setBrokenMonths] = useState<string[]>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<LifeRecord | undefined>()
  const [editorInitialType, setEditorInitialType] = useState<string | undefined>()
  const [editorTemplate, setEditorTemplate] = useState<RecordTypeTemplate | undefined>()
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [editorLoading, setEditorLoading] = useState(false)
  const [referenceTime, setReferenceTime] = useState(() => new Date())
  const loadReferenceTimeRef = useRef(new Date())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const olderRecordsSentinelRef = useRef<HTMLDivElement | null>(null)
  const filterComposingRef = useRef(false)
  const configured = useAtomValue(configuredAtom)
  const setCloudBlocked = useSetAtom(cloudBlockedAtom)
  const syncIndicator = useSyncExternalStore(
    subscribeSyncIndicator,
    getSyncIndicator,
    getSyncIndicator,
  )

  const uploadImages = useCallback(
    (files: File[]) => stageImageFiles(storage, files),
    [],
  )
  const [recordWorkflow] = useState(() =>
    createRecordWorkflow({ storage }),
  )
  const [typeTemplateWorkflow] = useState<TypeTemplateWorkflow>(() =>
    createTypeTemplateWorkflow({ storage }),
  )
  const discardStagedImages = useCallback(
    () => cleanupLocalOrphanImages(storage, Date.now(), 0).then(() => undefined),
    [],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setReferenceTime(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (recordData.initialStatus !== 'idle') return
    updateRecordData((current) => {
      if (current.initialStatus !== 'idle') return current
      return { ...current, initialStatus: 'loading', initialError: undefined }
    })
    void loadInitialRecords(storage, loadReferenceTimeRef.current)
      .then((result) => {
        updateRecordData((current) => ({
          ...current,
          records: sortRecords(result.records),
          nextMonth: result.nextMonth,
          earliestMonth: result.earliestMonth,
          initialStatus: 'ready',
          initialError: undefined,
          olderStatus: 'idle',
          olderError: undefined,
        }))
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        updateRecordData((current) => ({
          ...current,
          initialStatus: 'error',
          initialError: message,
        }))
        toaster.create({ title: '加载记录失败：' + message, type: 'error' })
      })
  }, [recordData.initialStatus])

  const refreshSyncIndicator = useCallback(async () => {
    if (!configured) return
    try {
      // 只读取 manifest；结果写入应用级缓存，不随记录页卸载而丢失。
      await refreshSharedSyncIndicator()
    } catch (error) {
      setCloudBlocked(true)
      toaster.create({
        title:
          '云端连接失败：' +
          (error instanceof Error ? error.message : String(error)),
        type: 'error',
      })
    }
  }, [configured, setCloudBlocked])

  useEffect(() => {
    void refreshSyncIndicator()
  }, [refreshSyncIndicator])

  const filteredRecords = useMemo(
    () => filterRecordsByType(records, filter),
    [filter, records],
  )
  const groups = useMemo(
    () => groupRecordsByDay(filteredRecords, referenceTime),
    [filteredRecords, referenceTime],
  )
  const items = useMemo(() => flattenGroups(groups), [groups])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (items[index]?.kind === 'day' ? 36 : 112),
    overscan: 6,
  })
  const virtualItems = virtualizer.getVirtualItems()

  async function loadOlderMonth() {
    const currentData = getRecordData()
    if (!currentData.nextMonth || currentData.olderStatus === 'loading') return
    const month = currentData.nextMonth
    updateRecordData((current) => ({
      ...current,
      olderStatus: 'loading',
      olderError: undefined,
    }))
    try {
      const older = await loadOlderRecords(storage, month)
      updateRecordData((current) => ({
        ...current,
        records: mergeRecords(current.records, older),
        nextMonth:
          current.earliestMonth && month !== current.earliestMonth
            ? previousMonth(month)
            : undefined,
        olderStatus: 'ready',
        olderError: undefined,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updateRecordData((current) => ({
        ...current,
        olderStatus: 'error',
        olderError: message,
      }))
      toaster.create({ title: '加载更早记录失败：' + message, type: 'error' })
    }
  }

  useEffect(() => {
    const root = scrollRef.current
    const sentinel = olderRecordsSentinelRef.current
    if (!root || !sentinel || !nextMonth) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !olderLoading && !olderLoadError) {
          void loadOlderMonth()
        }
      },
      { root, rootMargin: '240px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [items.length, nextMonth, olderLoading, olderLoadError])

  async function openNewRecord() {
    try {
      const templates = await typeTemplateWorkflow.list()
      updateTypeTemplateData((current) => ({
        ...current,
        templates,
        status: 'ready',
        error: undefined,
      }))
      setTemplatePickerOpen(true)
    } catch (error) {
      toaster.create({
        title: '读取类型模板失败：' +
          (error instanceof Error ? error.message : String(error)),
        type: 'error',
      })
    }
  }

  async function openExistingRecord(record: LifeRecord) {
    setEditorLoading(true)
    setEditorOpen(false)
    try {
      // 模板在编辑器打开前解析；打开后的输入过程中不再跟随模板热更新。
      const template = await typeTemplateWorkflow.find(record.type)
      setEditingRecord(record)
      setEditorInitialType(record.type)
      setEditorTemplate(template)
      setEditorOpen(true)
    } catch (error) {
      toaster.create({
        title: '读取类型模板失败：' +
          (error instanceof Error ? error.message : String(error)),
        type: 'error',
      })
    } finally {
      setEditorLoading(false)
    }
  }

  function selectTemplate(template: RecordTypeTemplate | undefined) {
    setTemplatePickerOpen(false)
    setEditingRecord(undefined)
    setEditorInitialType(template?.type)
    setEditorTemplate(template)
    setEditorOpen(true)
  }

  async function refreshRecords() {
    const result = await loadInitialRecords(storage, loadReferenceTimeRef.current)
    updateRecordData((current) => ({
      ...current,
      records: sortRecords(result.records),
      nextMonth: result.nextMonth,
      earliestMonth: result.earliestMonth,
      initialStatus: 'ready',
      initialError: undefined,
      olderStatus: 'idle',
      olderError: undefined,
    }))
  }

  async function refreshTypeTemplates() {
    const templates = await typeTemplateWorkflow.list()
    updateTypeTemplateData((current) => ({
      ...current,
      templates,
      status: 'ready',
      error: undefined,
    }))
  }

  async function requestConflictConfirmation(
    conflictMonths: string[],
    typeTemplatesConflict: boolean,
  ): Promise<boolean> {
    const items: ConflictItem[] = await Promise.all(
      conflictMonths.map(async (month) => ({
        month,
        localRecordCount: (await storage.getRecordsInMonth(month)).length,
        kind: 'month' as const,
      })),
    )
    if (typeTemplatesConflict) {
      items.push({
        month: '类型模板',
        localRecordCount: 0,
        kind: 'type-templates',
      })
    }
    return new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (confirmed: boolean) => {
        if (settled) return
        settled = true
        setConflictDialog(undefined)
        resolve(confirmed)
      }
      setConflictDialog({ items, resolve: finish })
    })
  }

  function reportCleanupError(error: unknown) {
    if (!error) return
    toaster.create({
      title:
        '本地图片清理失败：' +
        (error instanceof Error ? error.message : String(error)),
      type: 'error',
    })
  }

  async function handleSaved(saved: LifeRecord, previousTime: Date | undefined) {
    const result = await recordWorkflow.save(saved, previousTime)
    updateRecordData((current) => ({
      ...current,
      records: mergeRecords(current.records, [saved]),
    }))
    reportCleanupError(result.cleanupError)
    await refreshSyncIndicator()
    setEditorOpen(false)
    setEditingRecord(undefined)
    setEditorInitialType(undefined)
    setEditorTemplate(undefined)
    toaster.create({ title: '记录已保存', type: 'success' })
  }

  async function handleDeleted(record: LifeRecord) {
    const result = await recordWorkflow.delete(record)
    updateRecordData((current) => ({
      ...current,
      records: current.records.filter((item) => item.id !== record.id),
    }))
    reportCleanupError(result.cleanupError)
    await refreshSyncIndicator()
    toaster.create({ title: '记录已删除', type: 'success' })
    setEditorOpen(false)
    setEditingRecord(undefined)
    setEditorInitialType(undefined)
    setEditorTemplate(undefined)
  }

  async function handleSyncClick() {
    if (syncBusy || !isOnline) return
    const checkingOnly = syncIndicator === 'none'
    setSyncCheckIndicator(checkingOnly ? 'none' : undefined)
    setSyncBusy(true)
    try {
      // 「已同步」是上一次只读检查的结果；再次点击只刷新这个结果。
      // 如果检查发现云端或本地有变化，留给用户下一次点击再执行真正同步。
      if (syncIndicator === 'none') {
        await refreshSyncIndicator()
        return
      }

      const cloud = currentCloud()
      if (!cloud) {
        setCloudBlocked(true)
        return
      }
      const report = await syncCloud(storage, cloud, requestConflictConfirmation)
      let cleanupError: unknown
      if (report.outcome === 'downloaded' || report.outcome === 'synced') {
        try {
          await cleanupLocalOrphanImages(storage, Date.now(), 0)
        } catch (error) {
          // 同步结果已经落库，图片清理失败不应回滚或遮蔽同步结果。
          cleanupError = error
        }
        try {
          await refreshRecords()
        } catch (error) {
          toaster.create({
            title:
              '刷新记录失败：' +
              (error instanceof Error ? error.message : String(error)),
            type: 'error',
          })
        }
        try {
          await refreshTypeTemplates()
        } catch (error) {
          toaster.create({
            title:
              '刷新类型模板失败：' +
              (error instanceof Error ? error.message : String(error)),
            type: 'error',
          })
        }
      }
      reportCleanupError(cleanupError)
      await refreshSyncIndicator()
      const resultTitles = {
        uploaded: '已更新云端',
        downloaded: '已更新本地',
        synced: '已同步云端和本地',
        'already-latest': '已是最新',
        aborted: '已取消同步',
      } as const
      toaster.create({ title: resultTitles[report.outcome], type: 'success' })
      if (report.brokenMonths.length > 0) {
        setBrokenMonths(report.brokenMonths)
      }
      if (report.brokenTypeTemplates) {
        toaster.create({
          title: '类型模板文件无法读取，本地模板未更新',
          type: 'error',
        })
      }
    } catch (error) {
      setCloudBlocked(true)
      toaster.create({
        title:
          '同步失败：' +
          (error instanceof Error ? error.message : String(error)),
        type: 'error',
      })
    } finally {
      setSyncBusy(false)
      setSyncCheckIndicator(undefined)
    }
  }

  const syncStatus = syncStatusView(syncCheckIndicator ?? syncIndicator)

  return (
    <Box flex="1" minH="0" position="relative" display="flex" flexDirection="column">
      <Box p="md" flexShrink={0} bg="bg.muted">
        <Flex align="center" gap="sm">
          <InputGroup
            flex="1"
            startElement={<Icon as={LuSearch} boxSize="4" />}
          >
            <Input
              aria-label="筛选类型"
              variant="subtle"
              bg="bg.panel"
              placeholder="筛选类型"
              value={filterInput}
              onChange={(event) => setFilterInput(event.target.value)}
              onCompositionStart={() => {
                filterComposingRef.current = true
              }}
              onCompositionEnd={() => {
                filterComposingRef.current = false
              }}
              onKeyDown={(event) => {
                if (
                  event.key !== 'Enter' ||
                  event.nativeEvent.isComposing ||
                  filterComposingRef.current
                ) {
                  return
                }
                event.preventDefault()
                setFilter(event.currentTarget.value.trim())
              }}
            />
          </InputGroup>
          <Button
            variant="subtle"
            w="24"
            flexShrink={0}
            aria-label={syncStatus.label}
            aria-busy={syncBusy}
            disabled={syncBusy || !isOnline || !configured}
            onClick={() => void handleSyncClick()}
          >
            {syncBusy ? (
              <Spinner size="sm" />
            ) : (
              <Icon as={syncStatus.icon} boxSize="5" />
            )}
            <Text textStyle="sm">
              {syncCheckIndicator !== undefined ? syncStatus.label : syncBusy ? '同步中' : syncStatus.label}
            </Text>
          </Button>
        </Flex>
      </Box>

      {initialLoading ? (
        <Flex flex="1" align="center" justify="center" gap="sm" color="fg.muted">
          <Spinner size="sm" />
          <Text textStyle="sm">加载中…</Text>
        </Flex>
      ) : loadError ? (
        <Flex flex="1" align="center" justify="center" px="xl">
          <Text textStyle="sm" color="fg.error">加载失败，请稍后重试</Text>
        </Flex>
      ) : items.length === 0 && !nextMonth ? (
        <Flex flex="1" align="center" justify="center" px="xl">
          <Text textStyle="sm" color="fg.muted">
            {filter ? '没有匹配的记录。' : '暂无记录'}
          </Text>
        </Flex>
      ) : (
        <Box
          ref={scrollRef}
          flex="1"
          minH="0"
          overflowY="auto"
          overscrollBehaviorY="contain"
          px="md"
          role="list"
        >
          {items.length === 0 && (
            <Flex justify="center" px="xl" py="xl">
              <Text textStyle="sm" color="fg.muted">当前已加载月份没有匹配记录，继续下滑加载更早月份。</Text>
            </Flex>
          )}
          <Box height={virtualizer.getTotalSize()} position="relative" width="full">
            {virtualItems.map((virtualItem) => {
              const item = items[virtualItem.index]
              return (
                <Box
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  position="absolute"
                  top="0"
                  left="0"
                  width="full"
                  pb="sm"
                  transform={`translateY(${virtualItem.start}px)`}
                >
                  {item.kind === 'day' ? (
                    <RecordDayHeader label={item.group.label} />
                  ) : (
                    <RecordCard
                      record={item.record}
                      onOpen={openExistingRecord}
                      imageManager={imageManager}
                    />
                  )}
                </Box>
              )
            })}
          </Box>
          <Box ref={olderRecordsSentinelRef} height="1px" aria-hidden="true" />
          {olderLoadError && (
            <Flex direction="column" align="center" gap="sm" py="sm">
              <Text textStyle="sm" color="fg.error">加载更早记录失败</Text>
              <Button
                type="button"
                variant="subtle"
                onClick={() => void loadOlderMonth()}
              >
                重试
              </Button>
            </Flex>
          )}
          {olderLoading && (
            <Flex justify="center" align="center" gap="sm" py="sm" color="fg.muted">
              <Spinner size="sm" />
              <Text textStyle="sm">加载中…</Text>
            </Flex>
          )}
          <Box height="16" />
        </Box>
      )}

      <Button
        position="absolute"
        right="md"
        bottom="2xs"
        zIndex="1"
        borderRadius="full"
        boxSize="12"
        aria-label="新建记录"
        disabled={editorLoading}
        onClick={() => void openNewRecord()}
      >
        <Icon as={LuPlus} boxSize="6" />
      </Button>

      <RecordEditor
        open={editorOpen}
        record={editingRecord}
        initialType={editorInitialType}
        template={editorTemplate}
        onClose={() => {
          setEditorOpen(false)
          setEditingRecord(undefined)
          setEditorInitialType(undefined)
          setEditorTemplate(undefined)
        }}
        onDiscard={discardStagedImages}
        onUploadImages={uploadImages}
        imageManager={imageManager}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />

      <TypeTemplatePicker
        open={templatePickerOpen}
        templates={typeTemplates}
        onClose={() => setTemplatePickerOpen(false)}
        onSelect={selectTemplate}
      />

      <ConflictDialog state={conflictDialog} />
      <BrokenMonthsDialog
        months={brokenMonths}
        onClose={() => setBrokenMonths(undefined)}
      />
    </Box>
  )
}
