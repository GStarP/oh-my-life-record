---
name: oh-my-mobile-design-system
description: 构建移动端 Web 页面时使用。提供设计规范、符合规范的 React 组件库，确保 UI 美观、一致、明暗适配。
---

# Oh My Mobile Design System

本技能包含一套移动端 Web 设计规范，及配套的 React 组件库。

组件库基于 Chakra v3，通过自定义主题和自定义组件适配设计规范。

## 工作流程

### 1. 阅读规范

`DESIGN.md` 是完整的设计规范，是真理源。

### 2. 初始化

#### 2.1 安装依赖

```bash
pnpm add @chakra-ui/react @emotion/react react-icons
```

#### 2.2 复制源码

将 `src/` 下的文件复制到项目中:

- `system.ts`：**必需**，自定义主题。
- `components/*.tsx`：**按需**，自定义组件。

#### 2.3 包裹应用根

用 `ChakraProvider` + 自定义主题包裹应用根:

```tsx
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "./design-system/system";

export function App() {
  return <ChakraProvider value={system}>{/* 页面 */}</ChakraProvider>;
}
```

### 3. 构建页面

- 按照设计规范规划页面布局、构建页面元素。
- 如果设计规范和用户要求冲突、或者设计系统无法满足用户要求，详细说明情况等用户决定。

## 使用组件

**编写代码时，只使用组件，不使用 HTML 元素。**

### 自定义组件

只要存在自定义组件，就禁止使用功能相同的 Chakra 原生组件。

| 组件    | 用途                 | 文档                  |
| ------- | -------------------- | --------------------- |
| `Image` | 图片（支持无图占位） | `src/design-system/components/image.tsx` |

### 常用组件

#### 布局组件

| 组件   | 用途     | 文档                                         |
| ------ | -------- | -------------------------------------------- |
| `Box`  | 通用容器 | `https://chakra-ui.com/docs/components/box`  |
| `Flex` | 弹性布局 | `https://chakra-ui.com/docs/components/flex` |
| `Grid` | 网格布局 | `https://chakra-ui.com/docs/components/grid` |

#### 功能组件

| 组件             | 用途                 | 文档                                                   |
| ---------------- | -------------------- | ------------------------------------------------------ |
| `Text`            | 所有文字             | `https://chakra-ui.com/docs/components/text`           |
| `Checkbox`        | 复选框               | `https://chakra-ui.com/docs/components/checkbox`       |
| `File Upload`     | 文件上传             | `https://chakra-ui.com/docs/components/file-upload`    |
| `Input`           | 输入框               | `https://chakra-ui.com/docs/components/input`          |
| `Number Input`    | 数字输入框           | `https://chakra-ui.com/docs/components/number-input`   |
| `Password Input`  | 密码输入框           | `https://chakra-ui.com/docs/components/password-input` |
| `Radio`           | 单选框               | `https://chakra-ui.com/docs/components/radio`           |
| `Select`          | 下拉选择框           | `https://chakra-ui.com/docs/components/native-select`  |
| `Switch`           | 开关                 | `https://chakra-ui.com/docs/components/switch`         |
| `Textarea`         | 多行输入框           | `https://chakra-ui.com/docs/components/textarea`       |
| `Dialog`           | 弹窗                 | `https://chakra-ui.com/docs/components/dialog`         |
| `Drawer`           | 抽屉                 | `https://chakra-ui.com/docs/components/drawer`         |
| `Tabs`             | 标签页               | `https://chakra-ui.com/docs/components/tabs`           |
| `Spinner`          | 加载中               | `https://chakra-ui.com/docs/components/spinner`        |
| `Toast`            | 提示                 | `https://chakra-ui.com/docs/components/toast`          |
| `Card`             | 卡片                 | `https://chakra-ui.com/docs/components/card`           |
| `Icon`             | 图标（使用 react-icons） | `https://chakra-ui.com/docs/components/icon`           |
| `Tag`              | 标签                 | `https://chakra-ui.com/docs/components/tag`            |

项目内按需实现的共享组件位于 `src/design-system/components/`；当前的 `Image` 和
`PasswordInput` 都是基于 Chakra 原语的项目封装。若需探索其它组件可参考
`https://chakra-ui.com/docs/components/concepts/overview`。
