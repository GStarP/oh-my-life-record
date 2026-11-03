import { useEffect, useRef, useState } from 'react'
import { Box, Dialog, Icon, IconButton, Portal, Text, chakra } from '@chakra-ui/react'
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
      onOpenChange={(event) => { if (!event.open) onClose() }}
      initialFocusEl={() => closeRef.current}
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

/** 图片进入可见范围后读取缩略图，点击时读取本体。 */
export function RecordImage({ src, previewSrc, imageId, imageStore, boxSize, borderRadius, onError, unavailable, onRetry }: RecordImageProps) {
  const element = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const [localSource, setLocalSource] = useState<string>()
  const [failed, setFailed] = useState(false)
  const [preview, setPreview] = useState<string>()
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const target = element.current
    if (!target) return
    const observer = new IntersectionObserver(([entry]) => { setVisible(entry.isIntersecting) }, { rootMargin: '80px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true
    if (!visible || !imageId || !imageStore) return
    setFailed(false)
    void imageStore.source(imageId, true).then((url) => { if (active) setLocalSource(url) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [imageId, imageStore, visible, revision])
  const url = src ?? localSource
  const error = unavailable || failed
  async function open() {
    if (error) { setRevision((value) => value + 1); onRetry?.(); return }
    try {
      const full = previewSrc ?? (imageId && imageStore ? await imageStore.source(imageId, false) : url)
      if (full) setPreview(full)
    } catch { setFailed(true); onError?.() }
  }
  return <>
    <chakra.button ref={element} type="button" aria-label={error ? '重新读取图片' : '查看记录图片'} boxSize={boxSize} flexShrink="0" borderRadius={borderRadius} overflow="hidden" bg="bg.muted" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void open() }}>
      {error ? <Text fontSize="10px" color="fg.muted">读取失败，点击重试</Text> : url && visible ? <Image src={url} alt="记录图片" width="full" height="full" objectFit="cover" draggable={false} onError={() => { setFailed(true); onError?.() }} /> : <Box width="full" height="full" />}
    </chakra.button>
    {preview && <ImagePreview src={preview} onClose={() => setPreview(undefined)} onError={() => setFailed(true)} />}
  </>
}
