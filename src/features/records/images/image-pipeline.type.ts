/** 图片显示来源与内部加载器的类型定义。 */

export type ImageSource =
  | {
      kind: 'ready'
      url: string
      ownsUrl: boolean
      /** Blob 大小；用于页面内存缓存的容量估算。直链 fallback 没有该值。 */
      size?: number
    }
  | { kind: 'error' }

export type ImageSourceLoader = (imageId: string) => Promise<ImageSource>
