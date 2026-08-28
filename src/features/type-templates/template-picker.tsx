/** 新建记录前选择类型模板的 bottom sheet。 */
import { Drawer, Grid } from '@chakra-ui/react'
import { TypeTemplateTile } from './template-tile'
import type { TypeTemplatePickerProps } from './type'

export function TypeTemplatePicker({
  open,
  templates,
  onClose,
  onSelect,
}: TypeTemplatePickerProps) {
  return (
    <Drawer.Root
      open={open}
      placement="bottom"
      size="sm"
      onOpenChange={(event) => {
        if (!event.open) onClose()
      }}
    >
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content bg="bg.panel" borderTopRadius="2xl">
          <Drawer.Header>
            <Drawer.Title textStyle="md">选择类型</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body pb="2xl">
            <Grid templateColumns="repeat(4, minmax(0, 1fr))" gap="sm">
              <TypeTemplateTile
                icon="scroll"
                label="自由"
                surface="sheet"
                onClick={() => onSelect(undefined)}
              />
              {templates.map((template) => (
                <TypeTemplateTile
                  key={template.type}
                  icon={template.icon}
                  label={template.type}
                  surface="sheet"
                  onClick={() => onSelect(template)}
                />
              ))}
            </Grid>
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Positioner>
    </Drawer.Root>
  )
}
