import { Box, Image as ChakraImage, Icon } from '@chakra-ui/react'
import { LuImage } from 'react-icons/lu'
import type { ImageProps } from './image.type'

/**
 * Image —— 在 Chakra Image 基础上只增加一个特性:
 * 无 `src` 时显示灰色占位块(原生无此能力)。
 * 其余 props 与 Chakra Image 完全一致,全部透传。
 */
export function Image({ src, alt = '', ...rest }: ImageProps) {
  if (!src) {
    return (
      // 占位块默认 80px 正方形 + 4px 圆角;可被透传的 boxSize/borderRadius 等覆盖
      <Box
        boxSize='20'
        borderRadius='sm'
        bg='bg.muted'
        display='flex'
        alignItems='center'
        justifyContent='center'
        flexShrink={0}
        {...rest}
      >
        <Icon as={LuImage} boxSize='4' color='fg.subtle' />
      </Box>
    )
  }
  return <ChakraImage src={src} alt={alt} {...rest} />
}
