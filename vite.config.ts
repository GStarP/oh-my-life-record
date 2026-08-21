import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // 同步引擎与适配器均为纯 TS 逻辑，无需浏览器环境（jsdom）
    environment: 'node',
  },
})
