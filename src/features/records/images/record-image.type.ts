import type { ImageProps } from '../../../design-system/components/image.type'

export type RecordImageProps = {
  src: string | undefined
  boxSize: ImageProps['boxSize']
  borderRadius?: ImageProps['borderRadius']
  onError: () => void
}

export type ImagePreviewProps = {
  src: string
  onClose: () => void
  onError: () => void
}
