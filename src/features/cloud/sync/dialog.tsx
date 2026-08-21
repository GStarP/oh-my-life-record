/** 同步冲突与损坏分片的移动端确认弹窗。 */
import { Button, Dialog, Flex, Text } from '@chakra-ui/react'
import type {
  BrokenMonthsDialogProps,
  ConflictDialogProps,
} from './dialog.type'

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
            <Flex direction="column" gap="md">
              <Text textStyle="sm">
                确认后，以下月份会用云端数据覆盖本地未同步修改；取消则本次同步完全不执行。
              </Text>
              <Flex direction="column" gap="xs">
                {state?.items.map((item) => (
                  <Flex key={item.month} justify="space-between" gap="md">
                    <Text textStyle="sm">{item.month}</Text>
                    {item.kind === 'type-templates' ? (
                      <Text textStyle="sm" color="fg.muted">
                        将覆盖本地类型模板
                      </Text>
                    ) : (
                      <Text textStyle="sm" color="fg.muted">
                        将覆盖 {item.localRecordCount} 条本地记录
                      </Text>
                    )}
                  </Flex>
                ))}
              </Flex>
            </Flex>
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

export function BrokenMonthsDialog({
  months,
  onClose,
}: BrokenMonthsDialogProps) {
  return (
    <Dialog.Root
      open={months !== undefined && months.length > 0}
      onOpenChange={(event) => {
        if (!event.open) onClose()
      }}
    >
      <Dialog.Backdrop />
      <Dialog.Positioner alignItems="center" justifyContent="center">
        <Dialog.Content width="calc(100% - 2rem)" maxW="sm" bg="bg.panel">
          <Dialog.Header>
            <Dialog.Title textStyle="md">部分月份未更新</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Flex direction="column" gap="sm">
              <Text textStyle="sm">
                以下云端分片无法读取，本次同步已跳过这些月份：
              </Text>
              <Text textStyle="sm" color="fg.muted">
                {months?.join('、')}
              </Text>
            </Flex>
          </Dialog.Body>
          <Dialog.Footer>
            <Button width="full" variant="plain" onClick={onClose}>
              知道了
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}
