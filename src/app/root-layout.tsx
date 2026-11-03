import { Box, Flex, Icon, Link } from '@chakra-ui/react'
import { Link as RouterLink, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import { lazy, Suspense, useEffect, useState } from 'react'
import { LuClipboardList, LuSettings } from 'react-icons/lu'
import {
  credentialModalOpenAtom,
} from '../features/cloud/state'
import { CredentialModal } from '../features/cloud/credential/credential-modal'
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
  const navigate = useNavigate()
  const [modalOpen, setModalOpen] = useAtom(credentialModalOpenAtom)
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
    const back = (event: Event) => {
      if (document.querySelector('[role="dialog"][data-state="open"]')) {
        event.preventDefault()
        ;(document.activeElement ?? document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
      } else if (location.pathname !== '/records') {
        event.preventDefault()
        void navigate({ to: location.pathname === '/settings/type-templates' ? '/settings' : '/records' })
      }
    }
    document.addEventListener('android-back', back)
    return () => document.removeEventListener('android-back', back)
  }, [location.pathname, navigate])

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
