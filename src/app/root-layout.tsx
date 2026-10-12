/**
 * 根布局：底部 tab、用户主动打开的连接面板及前台检查生命周期。
 * 记录页和设置页由这里持有，路由切换只改变可见性，不卸载页面。
 */
import { Box, Flex, Icon, Link } from '@chakra-ui/react'
import { Link as RouterLink, Outlet, useRouterState } from '@tanstack/react-router'
import { useAtom, useAtomValue } from 'jotai'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { LuClipboardList, LuSettings } from 'react-icons/lu'
import {
  credentialAtom,
  credentialModalOpenAtom,
  syncBusyAtom,
} from '../features/cloud/state'
import { CredentialModal } from '../features/cloud/credential/credential-modal'
import { resetSyncIndicator, startSyncIndicatorMonitor } from './sync-indicator'
import { cleanupLocalOrphanImages } from '../features/records/images/image-staging'
import { storage } from './runtime'
import type { TabLinkProps } from './root-layout.type'

const LazyRecordsPage = lazy(() =>
  import('./routes/records').then(({ RecordsPage }) => ({
    default: RecordsPage,
  })),
)
const LazySettingsPage = lazy(() =>
  import('./routes/settings').then(({ SettingsPage }) => ({
    default: SettingsPage,
  })),
)

function TabLink({
  to,
  icon,
  label,
  active,
}: TabLinkProps) {
  return (
    <Box
      asChild
      flex="1"
      minW="0"
    >
      <Link asChild width="full" textDecoration="none" aria-label={label}>
        <RouterLink to={to}>
          <Flex
            width="full"
            align="center"
            justify="center"
            p="sm"
            rounded="full"
            color={active ? 'brand.fg' : 'fg.subtle'}
            bg={active ? 'bg.panel' : 'transparent'}
          >
            <Icon as={icon} boxSize="6" />
          </Flex>
        </RouterLink>
      </Link>
    </Box>
  )
}

export function RootLayout() {
  const credential = useAtomValue(credentialAtom)
  const [modalOpen, setModalOpen] = useAtom(credentialModalOpenAtom)
  const syncBusy = useAtomValue(syncBusyAtom)
  const busyRef = useRef(syncBusy)
  busyRef.current = syncBusy
  const { location } = useRouterState()
  const recordsVisible = location.pathname === '/records'
  const settingsVisible = location.pathname === '/settings'
  const typeTemplatesVisible = location.pathname === '/settings/type-templates'
  const [recordsMounted, setRecordsMounted] = useState(recordsVisible)
  const [settingsMounted, setSettingsMounted] = useState(settingsVisible)

  useEffect(() => {
    if (recordsVisible) setRecordsMounted(true)
    if (settingsVisible) setSettingsMounted(true)
  }, [recordsVisible, settingsVisible])

  useEffect(() => {
    resetSyncIndicator()
    return startSyncIndicatorMonitor(() => busyRef.current)
  }, [credential])

  useEffect(() => {
    // 本地图片孤儿清理属于应用启动兜底，不应依赖用户是否先进入记录页。
    void cleanupLocalOrphanImages(storage).catch(() => {})
  }, [])

  return (
    <Box
      height="100dvh"
      maxH="100dvh"
      overflow="hidden"
      bg="bg"
      display="flex"
      justifyContent="center"
    >
      <Box
        width="full"
        maxW="390px"
        height="100%"
        minH="0"
        bg="bg.muted"
        display="flex"
        flexDirection="column"
        overflowX="hidden"
      >
        <Box
          flex="1"
          minH="0"
          overflow="hidden"
          position="relative"
          display="flex"
          flexDirection="column"
        >
          {recordsMounted && (
            <Suspense fallback={<Box flex="1" minH="0" />}>
              {/* 保留布局尺寸，避免隐藏时的零尺寸污染虚拟列表测量缓存。 */}
              <Box
                position="absolute"
                inset="0"
                visibility={recordsVisible ? 'visible' : 'hidden'}
                inert={!recordsVisible}
                aria-hidden={!recordsVisible}
                display="flex"
                minH="0"
                flexDirection="column"
              >
                <LazyRecordsPage />
              </Box>
            </Suspense>
          )}
          {settingsMounted && (
            <Suspense fallback={<Box flex="1" minH="0" />}>
              <Box
                position="absolute"
                inset="0"
                visibility={settingsVisible ? 'visible' : 'hidden'}
                inert={!settingsVisible}
                aria-hidden={!settingsVisible}
                display="flex"
                minH="0"
                flexDirection="column"
              >
                <LazySettingsPage />
              </Box>
            </Suspense>
          )}
          {typeTemplatesVisible && (
            <Suspense fallback={<Box flex="1" minH="0" />}>
              <Box flex="1" minH="0" display="flex" flexDirection="column">
                <Outlet />
              </Box>
            </Suspense>
          )}
        </Box>
        <Flex p="md" bg="bg.muted" flexShrink={0} width="full">
          <TabLink
            to="/records"
            icon={LuClipboardList}
            label="记录"
            active={location.pathname.startsWith('/records')}
          />
          <TabLink
            to="/settings"
            icon={LuSettings}
            label="设置"
            active={location.pathname.startsWith('/settings')}
          />
        </Flex>
      </Box>
      <CredentialModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Box>
  )
}
