import { useEffect, useRef, useState } from 'react'
import { Box, Dialog, Icon, IconButton, Portal, chakra } from '@chakra-ui/react'
import Panzoom from '@panzoom/panzoom'
import { LuX } from 'react-icons/lu'
import { Image } from '../../../design-system/components/image'
import type {
  ImagePreviewProps,
  RecordImageProps,
} from './record-image.type'

function ImagePreview({ src, onClose, onError }: ImagePreviewProps) {
  const imageRef = useRef<HTMLDivElement>(null)
  const positionerRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const image = imageRef.current
    const positioner = positionerRef.current
    if (!image || !positioner) return
    const panzoom = Panzoom(image, {
      minScale: 1,
      maxScale: 8,
      contain: 'outside',
      panOnlyWhenZoomed: true,
      cursor: 'default',
    })
    // 触控板捏合使用 wheel；非 passive 监听才能阻止整页缩放。
    positioner.addEventListener('wheel', panzoom.zoomWithWheel, { passive: false })
    return () => {
      positioner.removeEventListener('wheel', panzoom.zoomWithWheel)
      panzoom.destroy()
    }
  }, [])

  return (
    <Dialog.Root
      open
      size="full"
      motionPreset="none"
      closeOnInteractOutside={false}
      closeOnEscape={false}
      initialFocusEl={() => closeRef.current}
      onEscapeKeyDown={(event) => event.preventDefault()}
    >
      <Portal>
        <Dialog.Positioner
          ref={positionerRef}
          overflow="hidden"
          touchAction="none"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Dialog.Content
            height="100dvh"
            bg="black/90"
            boxShadow="none"
            aria-describedby={undefined}
          >
            <Dialog.Title srOnly>记录图片预览</Dialog.Title>
            <Box
              position="absolute"
              inset="0"
              overflow="hidden"
              touchAction="none"
              userSelect="none"
            >
              <Box
                ref={imageRef}
                width="full"
                height="full"
                display="flex"
                alignItems="center"
                justifyContent="center"
                px="xl"
                py="16"
              >
                <Image
                  src={src}
                  alt="记录图片大图"
                  width="auto"
                  height="auto"
                  maxW="min(960px, 100%)"
                  maxH="min(720px, 100%)"
                  objectFit="contain"
                  draggable={false}
                  pointerEvents="none"
                  onError={onError}
                />
              </Box>
            </Box>
            <IconButton
              ref={closeRef}
              type="button"
              aria-label="关闭图片预览"
              position="absolute"
              top="calc(env(safe-area-inset-top, 0px) + 12px)"
              right="calc(env(safe-area-inset-right, 0px) + 12px)"
              zIndex="1"
              borderRadius="full"
              bg="black/64"
              color="white"
              _hover={{ bg: 'black/80' }}
              onClick={onClose}
            >
              <Icon as={LuX} boxSize="6" />
            </IconButton>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

/** 隔离图片事件，避免触发父级记录卡片的长按编辑。 */
export function RecordImage({ src, boxSize, borderRadius, onError }: RecordImageProps) {
  // 加载失败时也保留预览层和关闭按钮；资源恢复后使用最新 URL 继续显示。
  const [previewSource, setPreviewSource] = useState<string>()
  return (
    <>
      <chakra.button
        type="button"
        aria-label="查看记录图片"
        disabled={!src}
        boxSize={boxSize}
        flexShrink="0"
        borderRadius={borderRadius}
        overflow="hidden"
        cursor={src ? 'zoom-in' : 'default'}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          setPreviewSource(src)
        }}
      >
        <Image
          src={src}
          alt="记录图片"
          width="full"
          height="full"
          borderRadius={borderRadius}
          objectFit="cover"
          draggable={false}
          onError={onError}
        />
      </chakra.button>
      {previewSource && (
        <ImagePreview
          src={src ?? previewSource}
          onClose={() => setPreviewSource(undefined)}
          onError={onError}
        />
      )}
    </>
  )
}
