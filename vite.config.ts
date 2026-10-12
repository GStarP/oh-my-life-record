import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

/** HTML、入口和所有懒加载资源使用同一个内容版本，安装不依赖页面访问顺序。 */
function offlineShell(): Plugin {
  let outDir: string
  let workerTemplate: string
  return {
    name: 'offline-shell',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      workerTemplate = resolve(config.publicDir, 'sw.js')
    },
    async closeBundle() {
      const entries = await readdir(outDir, { recursive: true, withFileTypes: true })
      const files = entries.filter((entry) => entry.isFile() && entry.name !== 'sw.js')
        .map((entry) => resolve(entry.parentPath, entry.name)).sort()
      const hash = createHash('sha256')
      const assets = await Promise.all(files.map(async (file) => {
        const url = '/' + relative(outDir, file).split(sep).join('/')
        const integrity = 'sha256-' + createHash('sha256').update(await readFile(file)).digest('base64')
        return { url, integrity }
      }))
      for (const asset of assets) hash.update(asset.url).update(asset.integrity)
      const template = await readFile(workerTemplate, 'utf8')
      hash.update(template)
      await writeFile(resolve(outDir, 'sw.js'), template
        .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 16))
        .replace('/* __PRECACHE_ASSETS__ */ []', JSON.stringify(assets)))
    },
  }
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  test: {
    // 同步引擎与适配器均为纯 TS 逻辑，无需浏览器环境（jsdom）
    environment: 'node',
  },
})
