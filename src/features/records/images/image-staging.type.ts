/** 图片选择与本地暂存的类型定义。 */

export type StagedImagePreview = {
  id: string
  /** 暂存结果交给 ImageManager 生成显示用 Object URL。 */
  blob: Blob
}

export type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}
