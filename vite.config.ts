import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src/app',
    filename: 'sw.ts',
    // 注册仍由 main.tsx 负责，保持已安装客户端使用的 /sw.js 地址与升级行为。
    injectRegister: false,
    manifest: false,
    injectManifest: {
      globPatterns: ['**/*.{html,js,css,png,svg,ico,webmanifest,woff2}'],
      rollupFormat: 'iife',
    },
    integration: {
      configureOptions(config, options) {
        options.injectManifest!.manifestTransforms = [async (entries) => ({
          manifest: await Promise.all(entries.map(async (entry) => ({
            ...entry,
            // 版本号负责缓存查找；SRI 另行验证下载正文，拒绝部署切换中的混合版本。
            integrity: 'sha256-' + createHash('sha256')
              .update(await readFile(resolve(config.root, config.build.outDir, entry.url)))
              .digest('base64'),
            // 磁盘文件名与公开 URL 分开：导航与预缓存统一使用规范入口 /。
            url: entry.url === 'index.html' ? '/' : '/' + entry.url,
          }))),
          warnings: [],
        })]
      },
    },
  })],
  test: {
    // 同步引擎与适配器均为纯 TS 逻辑，无需浏览器环境（jsdom）
    environment: 'node',
  },
})
