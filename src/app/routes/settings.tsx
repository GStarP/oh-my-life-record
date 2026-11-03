import { Box, Button, Flex, Icon, Switch, Text } from '@chakra-ui/react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { credentialModalOpenAtom, syncBusyAtom } from '../../features/cloud/state'
import { colorModeAtom } from '../../features/preferences/state'
import { useNavigate } from '@tanstack/react-router'
import { LuChevronRight } from 'react-icons/lu'
import type { SectionProps, SettingsActionRowProps, SettingsRowProps } from './settings.type'

function Section({ title, children }: SectionProps) {
  return (
    <Flex direction="column" gap="xs">
      <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
        {title}
      </Text>
      <Box bg="bg.panel" rounded="lg" overflow="hidden">
        {children}
      </Box>
    </Flex>
  );
}

function SettingsRow({ label, children }: SettingsRowProps) {
  return (
    <Flex
      align="center"
      justify="space-between"
      gap="md"
      px="md"
      minH="16"
      borderBottomWidth="1px"
      borderColor="border.subtle"
      _last={{ borderBottomWidth: "0" }}
    >
      <Flex direction="column" gap="2xs" minW="0">
        <Text textStyle="sm" fontWeight="medium">
          {label}
        </Text>
      </Flex>
      <Box flexShrink={0}>{children}</Box>
    </Flex>
  );
}

function SettingsActionRow({
  label,
  disabled,
  onClick,
}: SettingsActionRowProps) {
  return (
    <Button
      width="full"
      size="2xl"
      px="md"
      textStyle="sm"
      variant="plain"
      justifyContent="space-between"
      borderRadius="0"
      borderBottomWidth="1px"
      borderColor="border.subtle"
      _last={{ borderBottomWidth: "0" }}
      disabled={disabled}
      onClick={onClick}
    >
      <Text textStyle="sm" fontWeight="medium">
        {label}
      </Text>
      <Icon as={LuChevronRight} boxSize="5" color="fg.subtle" />
    </Button>
  );
}

export function SettingsPage() {
  const navigate = useNavigate()
  const [colorMode, setColorMode] = useAtom(colorModeAtom)
  const setModal = useSetAtom(credentialModalOpenAtom)
  const busy = useAtomValue(syncBusyAtom)
  return <Box flex="1" minH="0" overflowY="auto" px="md" py="md">
    <Flex direction="column" gap="xl">
      <Section title="云端"><SettingsActionRow label="云端配置" disabled={busy} onClick={() => setModal(true)} /></Section>
      <Section title="记录"><SettingsActionRow label="类型模板" onClick={() => void navigate({ to: '/settings/type-templates' })} /></Section>
      <Section title="外观"><SettingsRow label="深色模式">
        <Switch.Root size="lg" checked={colorMode === 'dark'} onCheckedChange={(event) => setColorMode(event.checked ? 'dark' : 'light')}>
          <Switch.HiddenInput aria-label="深色模式" /><Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch.Root>
      </SettingsRow></Section>
    </Flex>
  </Box>
}
