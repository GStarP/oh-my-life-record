import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

/**
 * 主题：以 Chakra v3 默认主题为基线，只做最小覆写
 */
const config = defineConfig({
  globalCss: {
    html: {
      // 始终以 brand 作为主题色
      colorPalette: 'brand',
    },
  },
  theme: {
    tokens: {
      spacing: {
        '2xs': { value: '4px' },
        xs: { value: '8px' },
        sm: { value: '12px' },
        md: { value: '16px' },
        lg: { value: '20px' },
        xl: { value: '24px' },
        '2xl': { value: '28px' },
        '3xl': { value: '32px' },
      },
    },
    semanticTokens: {
      colors: {
        // 品牌色：当前为 gray
        brand: {
          solid: { value: { _light: '{colors.gray.900}', _dark: 'white' } },
          contrast: {
            value: { _light: 'white', _dark: '{colors.gray.950}' },
          },
          fg: {
            value: { _light: '{colors.gray.800}', _dark: '{colors.gray.200}' },
          },
          subtle: {
            value: { _light: '{colors.gray.100}', _dark: '{colors.gray.900}' },
          },
          muted: {
            value: { _light: '{colors.gray.200}', _dark: '{colors.gray.800}' },
          },
          emphasized: {
            value: { _light: '{colors.gray.300}', _dark: '{colors.gray.700}' },
          },
          focusRing: {
            value: { _light: '{colors.gray.400}', _dark: '{colors.gray.400}' },
          },
          border: {
            value: { _light: '{colors.gray.200}', _dark: '{colors.gray.800}' },
          },
        },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
