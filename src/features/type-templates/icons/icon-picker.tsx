/** 类型模板图标选择器：预览一个图标，点击后在 bottom sheet 中选择。 */
import { useState } from 'react'
import { Drawer, Grid, IconButton } from '@chakra-ui/react'
import {
  TYPE_TEMPLATE_ICON_OPTIONS,
} from './icon'
import { TypeTemplateIconView } from './icon-registry'
import type { TypeTemplateIconPickerProps } from './icon-picker.type'

export function TypeTemplateIconPicker({
  value,
  onChange,
  disabled = false,
}: TypeTemplateIconPickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <IconButton
        type="button"
        aria-label="选择图标"
        variant="subtle"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <TypeTemplateIconView icon={value} boxSize="6" />
      </IconButton>

      <Drawer.Root
        open={open}
        placement="bottom"
        size="sm"
        onOpenChange={(event) => setOpen(event.open)}
      >
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content bg="bg.panel" borderTopRadius="2xl">
            <Drawer.Header>
              <Drawer.Title textStyle="md">选择图标</Drawer.Title>
            </Drawer.Header>
            <Drawer.Body pb="2xl">
              <Grid
                templateColumns="repeat(auto-fit, minmax(3.5rem, 1fr))"
                gap="xs"
              >
                {TYPE_TEMPLATE_ICON_OPTIONS.map((option) => (
                  <IconButton
                    key={option.value}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={value === option.value}
                    width="full"
                    height="auto"
                    minH="0"
                    aspectRatio="1"
                    variant="subtle"
                    bg={
                      value === option.value ? 'bg.emphasized' : 'bg.muted'
                    }
                    onClick={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                  >
                    <TypeTemplateIconView
                      icon={option.value}
                      boxSize="5"
                    />
                  </IconButton>
                ))}
              </Grid>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Drawer.Root>
    </>
  )
}
