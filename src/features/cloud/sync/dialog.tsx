import { Button, Dialog, Flex, Portal, Spinner, Text } from '@chakra-ui/react'
import type { ConflictDialogProps, SyncProgressDialogProps } from './dialog.type'

export function SyncProgressDialog({ open, progress }: SyncProgressDialogProps) {
  const status = (progress?.stage ?? '准备同步') + (progress?.totalFiles ? `（${progress.files}/${progress.totalFiles}）` : '')
  return (
    <Dialog.Root open={open} closeOnEscape={false} closeOnInteractOutside={false} motionPreset="none">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner inset="0" alignItems="center" justifyContent="center" p="md">
          <Dialog.Content width="full" maxW="sm" bg="bg.panel" textAlign="center" p="lg">
            <Flex direction="column" align="center" gap="md" width="full">
              <Dialog.Title textStyle="md">正在同步</Dialog.Title>
              <Spinner size="lg" aria-hidden="true" />
              <Dialog.Description role="status" aria-live="polite" aria-atomic="true" textStyle="md" color="fg" h="6" width="full" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis" fontVariantNumeric="tabular-nums">{status}</Dialog.Description>
            </Flex>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

export function ConflictDialog({ state }: ConflictDialogProps) {
  return (
    <Dialog.Root
      open={state !== undefined}
      onOpenChange={(event) => {
        if (!event.open) state?.resolve(false)
      }}
    >
      <Dialog.Backdrop />
      <Dialog.Positioner alignItems="center" justifyContent="center">
        <Dialog.Content width="calc(100% - 2rem)" maxW="sm" bg="bg.panel">
          <Dialog.Header>
            <Dialog.Title textStyle="md">发现云端冲突</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text textStyle="sm">本地和云端都有修改。继续后，云端的全部记录、类型模板和图片会覆盖本地内容，本地未备份的修改会丢失。</Text>
          </Dialog.Body>
          <Dialog.Footer>
            <Flex width="full" gap="sm">
              <Button
                flex="1"
                variant="plain"
                onClick={() => state?.resolve(false)}
              >
                取消
              </Button>
              <Button
                flex="1"
                variant="subtle"
                colorPalette="red"
                onClick={() => state?.resolve(true)}
              >
                覆盖并同步
              </Button>
            </Flex>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}
