import type { ImageProps } from '../../../design-system/components/image.type'
import type { ImageStore } from './files.type'
export type RecordImageProps = {
  src?: string; previewSrc?: string; imageId?: string; imageStore?: ImageStore;
  boxSize: ImageProps['boxSize']; borderRadius?: ImageProps['borderRadius'];
  onError?: () => void; unavailable?: boolean; onRetry?: () => void;
}
export type ImagePreviewProps = { src: string; onClose: () => void; onError: () => void }
