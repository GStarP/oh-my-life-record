---
name: Oh My Mobile Design System
description: 移动端 Web 设计系统，唯一真理源，奉行规范化、扁平化、简约化的宗旨。

spacing:
  2xs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  2xl: 28px
  3xl: 32px

rounded:
  sm: 4px # 普通控件
  lg: 8px
  xl: 12px
  2xl: 16px # 卡片
  4xl: 32px
  full: 9999px

colors:
  # 语义 token (light / dark)，引用色板 token
  # 背景
  bg: white / black
  bg.subtle: gray.50 / gray.950
  bg.muted: gray.100 / gray.900 # 页面画布
  bg.emphasized: gray.200 / gray.800
  bg.panel: white / gray.950 # 卡片等元素表面
  bg.inverted: black / white
  bg.error: red.50 / red.950
  bg.warning: orange.50 / orange.950
  bg.success: green.50 / green.950
  bg.info: blue.50 / blue.950
  # 文字
  fg: black / gray.50 # 主文字
  fg.muted: gray.600 / gray.400 # 次要文字
  fg.subtle: gray.400 / gray.500 # 占位/禁用文字
  fg.inverted: gray.50 / black
  fg.error: red.500 / red.400
  fg.warning: orange.600 / orange.300
  fg.success: green.600 / green.300
  fg.info: blue.600 / blue.300
  # 描边
  border: gray.200 / gray.800
  border.subtle: gray.50 / gray.950
  border.muted: gray.100 / gray.900
  border.emphasized: gray.300 / gray.700
  border.inverted: gray.800 / gray.200
  border.error: red.500 / red.400
  border.warning: orange.500 / orange.400
  border.success: green.500 / green.400
  border.info: blue.500 / blue.400
  # 品牌色
  brand.solid: gray.900 / white # 实心填充
  brand.contrast: white / gray.950 # 实心上的文字
  brand.fg: gray.800 / gray.200 # 非实心上的文字
  # 由浅到深的三种背景
  brand.subtle: gray.100 / gray.900
  brand.muted: gray.200 / gray.800
  brand.emphasized: gray.300 / gray.700
  brand.focusRing: gray.400 / gray.400
  brand.border: gray.200 / gray.800
  # 全部颜色: gray / red / pink / purple / cyan / blue / teal / green / yellow / orange
  # 语义 token 与品牌色完全相同，如 `red.fg`

typography:
  # 文字大小
  xs: 0.75rem / 1rem
  sm: 0.875rem / 1.25rem
  md: 1rem / 1.5rem
  lg: 1.125rem / 1.75rem
  xl: 1.25rem / 1.875rem
  2xl: 1.5rem / 2rem
  3xl: 1.875rem / 2.375rem
  4xl: 2.25rem / 2.75rem
  # 字重:
  #  regular 400 正文
  #  medium 500 中等强调
  #  semi-bold 600 标题
  #  bold 700 重点强调
  # 字体:
  #  body / heading = Inter + 系统字体栈
  #  mono = SFMono-Regular, Menlo, Monaco, Consolas
---

## 核心准则

- **规范化。** 凡是间距、圆角、颜色、文字，只允许使用本规范中定义的语义 token，禁止直接写样式值。
- **扁平化。** 不用阴影，少用边框。用颜色和间距表达分隔。
- **简约化。** 不加装饰，不加说明文字。信息密度适中，不过度留白。
- **整体感。** 视觉上不显著地划分区域，如 header、footer 等，让所有元素自然排列在页面中。

## 颜色

- 使用 `bg.muted` 作为页面背景，`bg.panel` 作为需要凸显的元素的背景，普通元素用透明背景

**色板索引**: 全部颜色的色板 token 定义参见

- 源码:`node_modules/@chakra-ui/react/dist/cjs/theme/tokens/colors.cjs`(色阶 hex)与 `.../theme/semantic-tokens/colors.cjs`(语义角色双值)
- 文档:https://chakra-ui.com/docs/theming/colors

## 文字

- 在卡片中，通过组合不同文字大小、字重和颜色，体现出不同文字的层次感

## 布局

- 优先使用 flex 和 grid，禁止使用 float

## 响应式

- 仅考虑移动端，宽度超过 480px 的情况不做适配

## 尺寸

- 不限定语义 token，可自由设置，建议为 4px 的整数倍
