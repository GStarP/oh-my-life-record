/** 记录卡片与按天组头：只负责把已准备好的记录数据渲染成移动端列表项。 */
import { useRef, type PointerEvent } from 'react'
import { Card, Flex, Tag, Text } from '@chakra-ui/react'
import {
  LongPressEventType,
  useLongPress,
} from 'use-long-press'
import type { LongPressPointerHandlers } from 'use-long-press'
import { Image } from '../../../design-system/components/image'
import { formatTimeOfDay } from '../../../utils/time'
import { useImageSources } from '../images/use-image-sources'
import type {
  RecordAttributeTagsProps,
  RecordCardProps,
  RecordDayHeaderProps,
} from './record-list.type'

const TYPE_PALETTES = [
  'blue',
  'purple',
  'green',
  'orange',
  'pink',
  'cyan',
  'teal',
  'yellow',
  'red',
] as const

const LONG_PRESS_MS = 500
const POINTER_MOVE_TOLERANCE = 8

function paletteForType(type: string): (typeof TYPE_PALETTES)[number] {
  // 混合完整 Unicode 字符码，再将散列高位折叠进色板索引。
  // 颜色只依赖类型文字，不随模板来源、记录加载顺序或设备改变。
  let hash = 2166136261
  for (const character of type) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619)
  }
  hash ^= hash >>> 16
  return TYPE_PALETTES[(hash >>> 0) % TYPE_PALETTES.length]
}

function AttributeTags({ record }: RecordAttributeTagsProps) {
  const entries = Object.entries(record.attributes)
  if (entries.length === 0) return null
  return (
    <Flex gap="xs" wrap="wrap">
      {entries.map(([key, value]) => (
        <Tag.Root key={key} size="sm" variant="subtle">
          <Tag.Label>
            <Flex as="span" align="center" gap="2xs">
              <Text as="span" textStyle="xs" color="fg.muted">{key}</Text>
              <Text as="span" textStyle="xs">
                {typeof value === 'boolean' ? (value ? '是' : '否') : String(value)}
              </Text>
            </Flex>
          </Tag.Label>
        </Tag.Root>
      ))}
    </Flex>
  )
}

export function RecordCard({ record, onOpen, imageManager }: RecordCardProps) {
  const pointerInteraction = useRef(false)
  const { sources: imageSources, invalidateImage } = useImageSources(
    imageManager,
    record.images,
  )
  // 鼠标、触控板、触摸屏和手写笔都可能产生 PointerEvent；只交给成熟库
  // 统一处理按压与移动取消，不按 pointerType 过滤，避免桌面长按失效。
  const longPressBind = useLongPress<HTMLElement>(() => onOpen(record), {
    threshold: LONG_PRESS_MS,
    detect: LongPressEventType.Pointer,
    cancelOnMovement: POINTER_MOVE_TOLERANCE,
    cancelOutsideElement: true,
  })() as LongPressPointerHandlers<HTMLElement>

  function handleImageError(imageId: string) {
    invalidateImage(imageId)
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    pointerInteraction.current = true
    longPressBind.onPointerDown(event)
  }

  function handlePointerUp(event: PointerEvent<HTMLElement>) {
    pointerInteraction.current = false
    longPressBind.onPointerUp(event)
  }

  function handlePointerLeave(event: PointerEvent<HTMLElement>) {
    pointerInteraction.current = false
    longPressBind.onPointerLeave?.(event)
  }

  function handlePointerCancel(event: PointerEvent<HTMLElement>) {
    pointerInteraction.current = false
    longPressBind.onPointerUp(event)
  }

  return (
    <Card.Root
      width="full"
      textAlign="left"
      variant="subtle"
      bg="bg.panel"
      role="button"
      tabIndex={0}
      cursor="default"
      touchAction="pan-y"
      {...longPressBind}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(event) => event.preventDefault()}
      onFocus={(event) => {
        if (pointerInteraction.current) event.currentTarget.blur()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen(record)
      }}
    >
      <Card.Body p="md">
        <Flex direction="column" gap="sm">
          <Flex align="center" justify="space-between">
            <Tag.Root
              colorPalette={paletteForType(record.type)}
              variant="subtle"
              size="lg"
              fontWeight="medium"
            >
              <Tag.Label>{record.type || '未分类'}</Tag.Label>
            </Tag.Root>
            <Text textStyle="sm" as="span" color="fg.muted" flexShrink={0}>
              {formatTimeOfDay(record.time)}
            </Text>
          </Flex>

          {record.name?.trim() && (
            <Text
              textStyle="sm"
              color="fg"
              whiteSpace="pre-wrap"
              overflowWrap="anywhere"
            >
              {record.name}
            </Text>
          )}

          {record.description.trim() && (
            <Text
              textStyle="sm"
              color="fg.muted"
              whiteSpace="pre-wrap"
              overflowWrap="anywhere"
            >
              {record.description}
            </Text>
          )}

          <AttributeTags record={record} />

          {record.images.length > 0 && (
            <Flex gap="xs" overflowX="auto">
              {record.images.map((imageId) => (
                <Image
                  key={imageId}
                  src={
                    imageSources[imageId]?.kind === 'ready'
                      ? imageSources[imageId].url
                      : undefined
                  }
                  alt="记录图片"
                  boxSize="16"
                  flexShrink="0"
                  objectFit="cover"
                  onError={() => handleImageError(imageId)}
                />
              ))}
            </Flex>
          )}
        </Flex>
      </Card.Body>
    </Card.Root>
  )
}

export function RecordDayHeader({ label }: RecordDayHeaderProps) {
  return (
    <Text py="2xs" textStyle="sm" fontWeight="semibold" color="fg.muted">
      {label}
    </Text>
  )
}
