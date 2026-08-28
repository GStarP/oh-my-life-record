/** 类型模板编辑 bottom sheet。 */
import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  Drawer,
  Field,
  Flex,
  Grid,
  Input,
  NativeSelect,
  Spinner,
  TagsInput,
  Text,
} from '@chakra-ui/react'
import { LuTrash2 } from 'react-icons/lu'
import { ulid } from 'ulidx'
import {
  DEFAULT_TYPE_TEMPLATE_ICON,
} from './icons/icon'
import type {
  RecordTypeTemplate,
  TemplateAttributeKind,
} from './type'
import { toaster } from '../notifications/toaster'
import { TypeTemplateIconPicker } from './icons/icon-picker'
import { normalizeTemplate, templateKindLabel, validateTemplate } from './model'
import type { TemplateDraftAttribute, TypeTemplateEditorProps } from './type'

const kinds: TemplateAttributeKind[] = [
  'text',
  'number',
  'boolean',
  'option',
]

function draftAttributes(template: RecordTypeTemplate | undefined): TemplateDraftAttribute[] {
  return (template?.attributes ?? []).map((attribute) => ({
    id: ulid(),
    name: attribute.name,
    kind: attribute.kind,
    options: [...(attribute.options ?? [])],
  }))
}

export function TypeTemplateEditor({
  open,
  template,
  existingTypes,
  onClose,
  onSaved,
  onDeleted,
}: TypeTemplateEditorProps) {
  const [type, setType] = useState('')
  const [icon, setIcon] = useState(DEFAULT_TYPE_TEMPLATE_ICON)
  const [attributes, setAttributes] = useState<TemplateDraftAttribute[]>([])
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!open) return
    setType(template?.type ?? '')
    setIcon(template?.icon ?? DEFAULT_TYPE_TEMPLATE_ICON)
    setAttributes(draftAttributes(template))
    setSaving(false)
    setDeleteOpen(false)
    setDeleting(false)
  }, [open, template?.icon, template?.type])

  function updateAttribute(
    id: string,
    update: (attribute: TemplateDraftAttribute) => TemplateDraftAttribute,
  ) {
    setAttributes((current) =>
      current.map((attribute) =>
        attribute.id === id ? update(attribute) : attribute,
      ),
    )
  }

  async function save() {
    const next = normalizeTemplate({
      type,
      icon,
      attributes: attributes.map((attribute) => ({
        name: attribute.name,
        kind: attribute.kind,
        options: attribute.kind === 'option' ? attribute.options : undefined,
      })),
    })
    const validationError = validateTemplate(next, existingTypes, template?.type)
    if (validationError) {
      toaster.create({ title: validationError, type: 'error' })
      return
    }
    setSaving(true)
    try {
      await onSaved(next)
    } catch (caught) {
      toaster.create({
        title: '保存失败：' + (caught instanceof Error ? caught.message : String(caught)),
        type: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  async function deleteTemplate() {
    if (!template || deleting) return
    setDeleting(true)
    try {
      await onDeleted(template.type)
      setDeleteOpen(false)
    } catch (caught) {
      toaster.create({
        title: '删除失败：' + (caught instanceof Error ? caught.message : String(caught)),
        type: 'error',
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Drawer.Root
        open={open}
        placement="bottom"
        size="lg"
        closeOnInteractOutside={false}
        closeOnEscape={false}
        onOpenChange={() => {}}
      >
        <Drawer.Backdrop />
        <Drawer.Positioner>
          <Drawer.Content bg="bg.panel" borderTopRadius="2xl" maxH="90dvh">
            <Drawer.Header>
              <Flex align="center" justify="space-between" width="full">
                <Drawer.Title textStyle="lg">
                  {template ? '编辑类型模板' : '新建类型模板'}
                </Drawer.Title>
                <Button
                  variant="plain"
                  disabled={saving || deleting}
                  onClick={onClose}
                >
                  取消
                </Button>
              </Flex>
            </Drawer.Header>
            <Drawer.Body
              overflowY="auto"
              pb="3xl"
              pointerEvents={saving || deleting ? 'none' : 'auto'}
            >
              <Flex direction="column" gap="lg">
                <Grid
                  templateColumns="2.5rem minmax(0, 1fr)"
                  gap="sm"
                  alignItems="end"
                >
                  <Field.Root>
                    <Field.Label textStyle="sm">图标</Field.Label>
                    <TypeTemplateIconPicker
                      value={icon}
                      disabled={saving || deleting}
                      onChange={setIcon}
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label textStyle="sm">类型</Field.Label>
                    <Input
                      value={type}
                      readOnly={template !== undefined}
                      bg={template ? 'bg.muted' : undefined}
                      onChange={(event) => setType(event.target.value)}
                    />
                  </Field.Root>
                </Grid>

                <Box>
                  <Flex align="center" justify="space-between" mb="sm">
                    <Text textStyle="sm" color="fg.muted">
                      预置属性
                    </Text>
                    <Button
                      variant="subtle"
                      onClick={() =>
                        setAttributes((current) => [
                          ...current,
                          {
                            id: ulid(),
                            name: '',
                            kind: 'text',
                            options: [],
                          },
                        ])
                      }
                    >
                      添加
                    </Button>
                  </Flex>
                  <Flex direction="column" gap="md">
                    {attributes.map((attribute) => (
                      <Grid
                        key={attribute.id}
                        templateColumns="6rem minmax(0, 1fr) auto"
                        gap="xs"
                        alignItems="center"
                      >
                        <NativeSelect.Root width="full">
                          <NativeSelect.Field
                            aria-label="属性类型"
                            value={attribute.kind}
                            onChange={(event) =>
                              updateAttribute(attribute.id, (current) => ({
                                ...current,
                                kind: event.target.value as TemplateAttributeKind,
                              }))
                            }
                          >
                            {kinds.map((kind) => (
                              <option key={kind} value={kind}>
                                {templateKindLabel(kind)}
                              </option>
                            ))}
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                        <Input
                          minW="0"
                          value={attribute.name}
                          onChange={(event) =>
                            updateAttribute(attribute.id, (current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label="删除预置属性"
                          onClick={() =>
                            setAttributes((current) =>
                              current.filter((item) => item.id !== attribute.id),
                            )
                          }
                        >
                          <LuTrash2 />
                        </Button>
                        {attribute.kind === 'option' && (
                          <TagsInput.Root
                            gridColumn="1 / span 2"
                            mt="xs"
                            width="full"
                            value={attribute.options}
                            allowDuplicates={false}
                            onValueChange={(details) =>
                              updateAttribute(attribute.id, (current) => ({
                                ...current,
                                options: details.value,
                              }))
                            }
                          >
                            <TagsInput.Control>
                              <TagsInput.Items />
                              <TagsInput.Input />
                            </TagsInput.Control>
                          </TagsInput.Root>
                        )}
                      </Grid>
                    ))}
                  </Flex>
                </Box>

                <Flex direction="column" gap="sm" mt="lg">
                  <Button
                    width="full"
                    disabled={saving || deleting}
                    onClick={() => void save()}
                  >
                    {saving ? <Spinner size="sm" /> : '保存'}
                  </Button>
                  {template && (
                    <Button
                      width="full"
                      variant="subtle"
                      colorPalette="red"
                      disabled={saving || deleting}
                      onClick={() => setDeleteOpen(true)}
                    >
                      删除
                    </Button>
                  )}
                </Flex>
              </Flex>
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Drawer.Root>

      <Dialog.Root
        open={deleteOpen}
        onOpenChange={(event) => {
          if (!event.open && !deleting) setDeleteOpen(false)
        }}
        onEscapeKeyDown={(event) => {
          if (deleting) event.preventDefault()
        }}
        onPointerDownOutside={(event) => {
          if (deleting) event.preventDefault()
        }}
      >
        <Dialog.Backdrop />
        <Dialog.Positioner alignItems="center" justifyContent="center">
          <Dialog.Content width="calc(100% - 2rem)" maxW="sm" bg="bg.panel">
            <Dialog.Header>
              <Dialog.Title textStyle="md">删除类型模板</Dialog.Title>
            </Dialog.Header>
            <Dialog.Footer>
              <Flex width="full" gap="sm">
                <Button
                  flex="1"
                  variant="plain"
                  disabled={deleting}
                  onClick={() => setDeleteOpen(false)}
                >
                  取消
                </Button>
                <Button
                  flex="1"
                  colorPalette="red"
                  disabled={deleting}
                  onClick={() => void deleteTemplate()}
                >
                  {deleting ? <Spinner size="sm" /> : '删除'}
                </Button>
              </Flex>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </>
  )
}
