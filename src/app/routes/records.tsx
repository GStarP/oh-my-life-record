import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRouterState } from '@tanstack/react-router'
import { Box, Button, Flex, Icon, Input, InputGroup, Spinner, Text } from '@chakra-ui/react'
import { LuPlus, LuRefreshCw, LuSearch } from 'react-icons/lu'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { currentCloud, imageStore, storage, syncContext } from '../runtime'
import { credentialModalOpenAtom, syncBusyAtom, syncProgressAtom } from '../../features/cloud/state'
import { ConflictDialog, SyncProgressDialog } from '../../features/cloud/sync/dialog'
import type { ConflictDialogState } from '../../features/cloud/sync/dialog.type'
import { sync } from '../../features/cloud/sync/engine'
import { createSyncProgressDisplay } from '../../features/cloud/sync/progress'
import { cloudErrorMessage } from '../../features/cloud/request-error'
import { toaster } from '../../features/notifications/toaster'
import { pickImages } from '../../features/records/images/image-import'
import type { DraftImage } from '../../features/records/images/image-import.type'
import { filterRecordsByType, groupRecordsByDay } from '../../features/records/list/record-list'
import { RecordCard, RecordDayHeader } from '../../features/records/list/record-card'
import { RecordEditor } from '../../features/records/editor/record-editor'
import { createRecordWorkflow } from '../../features/records/record-workflow'
import { TypeTemplatePicker } from '../../features/type-templates/template-picker'
import { typeTemplateDataAtom, updateTypeTemplateData } from '../../features/type-templates/state'
import { createTypeTemplateWorkflow } from '../../features/type-templates/workflow'
import type { LifeRecord } from '../../features/records/type'
import type { RecordTypeTemplate } from '../../features/type-templates/type'
import type { RecordListItem } from '../../features/records/list/record-list.type'
import type { RecordPage } from '../../features/storage/type'

function mergeRecords(current: LifeRecord[], incoming: LifeRecord[]): LifeRecord[] {
  const byId = new Map(current.map((record) => [record.id, record]))
  for (const record of incoming) byId.set(record.id, record)
  return [...byId.values()].sort((a, b) => b.time.getTime() - a.time.getTime() || (a.id < b.id ? 1 : -1))
}
export function RecordsPage() {
  const visible = useRouterState({ select: (state) => state.location.pathname === '/records' })
  const typeTemplates = useAtomValue(typeTemplateDataAtom).templates
  const [page, setPage] = useState<RecordPage>({ records: [] })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [filterInput, setFilterInput] = useState('')
  const [filter, setFilter] = useState('')
  const [syncBusy, setSyncBusy] = useAtom(syncBusyAtom)
  const [progress, setProgress] = useAtom(syncProgressAtom)
  const [conflict, setConflict] = useState<ConflictDialogState>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<LifeRecord>()
  const [editorTemplate, setEditorTemplate] = useState<RecordTypeTemplate>()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editorLoading, setEditorLoading] = useState(false)
  const [referenceTime, setReferenceTime] = useState(() => new Date())
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const queryGeneration = useRef(0)
  const loadingRef = useRef(false)
  const composing = useRef(false)
  const setCredentialModal = useSetAtom(credentialModalOpenAtom)
  const [records] = useState(() => createRecordWorkflow({ storage, images: imageStore }))
  const [templates] = useState(() => createTypeTemplateWorkflow({ storage }))

  const reload = useCallback(async () => {
    const generation = ++queryGeneration.current
    loadingRef.current = true; setLoading(true); setLoadError(undefined)
    try {
      const result = await storage.queryRecords({ type: filter })
      if (generation === queryGeneration.current) setPage(result)
    } catch (error) {
      if (generation === queryGeneration.current) setLoadError(cloudErrorMessage(error))
    } finally {
      if (generation === queryGeneration.current) { loadingRef.current = false; setLoading(false) }
    }
  }, [filter])
  useEffect(() => { scrollRef.current?.scrollTo(0, 0); void reload() }, [reload])
  useEffect(() => {
    const timer = window.setInterval(() => setReferenceTime(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const items = useMemo(() => {
    const result: RecordListItem[] = []
    for (const group of groupRecordsByDay(page.records, referenceTime)) {
      result.push({ kind: 'day', group })
      for (const record of group.records) result.push({ kind: 'record', record })
    }
    return result
  }, [page.records, referenceTime])
  const virtualizer = useVirtualizer({
    count: items.length,
    getItemKey: (index) => { const item = items[index]; return item.kind === 'day' ? 'day:' + item.group.key : item.record.id },
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => items[index]?.kind === 'day' ? 36 : 112,
    overscan: 6,
  })
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false

  async function loadMore() {
    if (!page.cursor || loadingRef.current) return
    const generation = queryGeneration.current
    loadingRef.current = true; setLoading(true); setLoadError(undefined)
    try {
      const result = await storage.queryRecords({ type: filter, cursor: page.cursor })
      if (generation === queryGeneration.current) setPage((current) => ({ records: mergeRecords(current.records, result.records), cursor: result.cursor }))
    } catch (error) {
      if (generation === queryGeneration.current) setLoadError(cloudErrorMessage(error))
    } finally {
      if (generation === queryGeneration.current) { loadingRef.current = false; setLoading(false) }
    }
  }
  useEffect(() => {
    if (!visible || !page.cursor || !scrollRef.current || !sentinelRef.current || loading || loadError) return
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void loadMore() }, { root: scrollRef.current, rootMargin: '240px 0px' })
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [visible, page.cursor, loading, loadError])

  async function openNew() {
    if (syncBusy) return
    try {
      const list = await templates.list()
      updateTypeTemplateData((current) => ({ ...current, templates: list, status: 'ready', error: undefined }))
      setPickerOpen(true)
    } catch (error) { toaster.create({ title: '读取模板失败：' + cloudErrorMessage(error), type: 'error' }) }
  }
  async function openExisting(record: LifeRecord) {
    if (syncBusy) return
    setEditorLoading(true)
    try {
      setEditorTemplate(await templates.find(record.type)); setEditingRecord(record); setEditorOpen(true)
    } catch (error) { toaster.create({ title: '读取模板失败：' + cloudErrorMessage(error), type: 'error' }) }
    finally { setEditorLoading(false) }
  }
  function selectTemplate(template: RecordTypeTemplate | undefined) {
    setPickerOpen(false); setEditingRecord(undefined); setEditorTemplate(template); setEditorOpen(true)
  }
  async function save(record: LifeRecord, drafts: DraftImage[]) {
    await records.save(record, drafts)
    queryGeneration.current++; loadingRef.current = false; setLoading(false)
    setPage((current) => ({ ...current, records: filterRecordsByType(mergeRecords(current.records, [record]), filter) }))
    setEditorOpen(false)
    toaster.create({ title: '记录已保存', type: 'success' })
  }
  async function remove(record: LifeRecord) {
    await records.delete(record)
    queryGeneration.current++; loadingRef.current = false; setLoading(false)
    setPage((current) => ({ ...current, records: current.records.filter((item) => item.id !== record.id) }))
    setEditorOpen(false)
    toaster.create({ title: '记录已删除', type: 'success' })
  }
  async function synchronize() {
    if (syncBusy || editorOpen || pickerOpen) return
    const cloud = currentCloud()
    if (!cloud) { setCredentialModal(true); return }
    setSyncBusy(true)
    const display = createSyncProgressDisplay(setProgress)
    let refresh = false
    let result: string | undefined
    let failed = false
    try {
      await display.update({ stage: '准备同步', files: 0, totalFiles: 0, bytes: 0, totalBytes: 0 })
      const outcome = await sync({ storage, cloud, context: syncContext(
        async () => {
          await display.finish()
          return new Promise<boolean>((resolve) => setConflict({ resolve: (answer) => { setConflict(undefined); resolve(answer) } }))
        },
        display.update,
      ) })
      refresh = outcome === 'downloaded'
      result = { uploaded: '云端已更新', downloaded: '本地已更新', 'already-latest': '已是最新', aborted: undefined }[outcome]
    } catch (error) {
      refresh = true
      failed = true
      result = '同步失败：' + cloudErrorMessage(error)
    } finally {
      try {
        if (refresh) {
          await display.update({ stage: '刷新本地数据', files: 0, totalFiles: 0, bytes: 0, totalBytes: 0 })
          await reload()
          try {
            const list = await templates.list()
            updateTypeTemplateData((current) => ({ ...current, templates: list, status: 'ready', error: undefined }))
          } catch (error) { toaster.create({ title: '读取模板失败：' + cloudErrorMessage(error), type: 'error' }) }
        }
      } finally {
        await display.finish()
        // 关闭期间保留最后阶段，直到下一次同步发布初始状态。
        setSyncBusy(false)
      }
    }
    if (result) toaster.create({ title: result, type: failed ? 'error' : 'success' })
  }
  return (
    <Box flex="1" minH="0" position="relative" display="flex" flexDirection="column">
      <Box p="md" flexShrink={0} bg="bg.muted">
        <Flex align="center" gap="sm">
          <InputGroup flex="1" startElement={<Icon as={LuSearch} boxSize="4" />}>
            <Input aria-label="筛选类型" variant="subtle" bg="bg.panel" placeholder="筛选类型" value={filterInput}
              onChange={(event) => setFilterInput(event.target.value)} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); setFilter(filterInput.trim()); event.currentTarget.blur() } }} />
          </InputGroup>
          <Button variant="subtle" px="sm" flexShrink={0} disabled={syncBusy} aria-label="手动同步" aria-busy={syncBusy} onClick={() => void synchronize()}>
            {syncBusy ? <Spinner size="sm" /> : <Icon as={LuRefreshCw} boxSize="5" />}<Text textStyle="sm">{syncBusy ? '同步中' : '同步'}</Text>
          </Button>
        </Flex>
      </Box>
      {loading && page.records.length === 0 ? <Flex flex="1" align="center" justify="center" gap="sm"><Spinner size="sm" /><Text>加载中…</Text></Flex>
        : loadError && page.records.length === 0 ? <Flex flex="1" align="center" justify="center" direction="column" gap="sm"><Text color="fg.error">加载失败：{loadError}</Text><Button onClick={() => void reload()}>重试</Button></Flex>
        : page.records.length === 0 ? <Flex flex="1" align="center" justify="center"><Text color="fg.muted">{filter ? '没有匹配的记录' : '暂无记录'}</Text></Flex>
        : <Box ref={scrollRef} flex="1" minH="0" overflowY="auto" overflowAnchor="none" overscrollBehaviorY="contain" px="md" role="list">
          <Box height={virtualizer.getTotalSize()} position="relative" width="full">
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const item = items[virtualItem.index]
              return <Box key={virtualItem.key} ref={virtualizer.measureElement} data-index={virtualItem.index} position="absolute" top="0" left="0" width="full" pb="sm" transform={`translateY(${virtualItem.start}px)`}>
                {item.kind === 'day' ? <RecordDayHeader label={item.group.label} /> : <RecordCard record={item.record} onOpen={openExisting} imageStore={imageStore} />}
              </Box>
            })}
          </Box>
          <Box ref={sentinelRef} height="1px" aria-hidden="true" />
          {loading && <Flex justify="center" py="sm"><Spinner size="sm" /></Flex>}
          {loadError && <Flex direction="column" align="center" gap="sm"><Text color="fg.error">加载失败：{loadError}</Text><Button onClick={() => void loadMore()}>重试</Button></Flex>}
          <Box height="16" />
        </Box>}
      <Button position="absolute" right="md" bottom="2xs" zIndex="1" borderRadius="full" boxSize="12" aria-label="新建记录" disabled={editorLoading || syncBusy} onClick={() => void openNew()}><Icon as={LuPlus} boxSize="6" /></Button>
      <RecordEditor open={editorOpen} record={editingRecord} initialType={editingRecord?.type ?? editorTemplate?.type} template={editorTemplate} onClose={() => setEditorOpen(false)} onPickImages={pickImages} imageStore={imageStore} onSaved={save} onDeleted={remove} />
      <TypeTemplatePicker open={pickerOpen} templates={typeTemplates} onClose={() => setPickerOpen(false)} onSelect={selectTemplate} />
      <SyncProgressDialog open={syncBusy && !conflict} progress={progress} />
      <ConflictDialog state={conflict} />
    </Box>
  )
}
