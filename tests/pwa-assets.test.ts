import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import type { ManifestOptions } from 'vite-plugin-pwa'

const publicDir = resolve(process.cwd(), 'public')

describe('PWA 公共资源', () => {
  it('清单、安装图标和 HTML 发现入口保持完整', async () => {
    // 安装后应进入记录页并使用独立应用窗口；同时检查清单引用的图标与 HTML 发现入口，
    // 防止配置可读但缺少图标或发现链接，导致浏览器无法使用完整的安装配置。
    const manifest = JSON.parse(
      await readFile(resolve(publicDir, 'manifest.webmanifest'), 'utf8'),
    ) as Partial<ManifestOptions>

    expect(manifest.start_url).toBe('/records')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/omlr-icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icons/omlr-icon-512.png', sizes: '512x512' }),
      ]),
    )

    for (const icon of manifest.icons ?? []) {
      await expect(stat(resolve(publicDir, icon.src.slice(1)))).resolves.toBeDefined()
    }

    const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon.png"')
    await expect(stat(resolve(publicDir, 'icons/favicon.png'))).resolves.toBeDefined()
  })
})

describe('生产离线壳', () => {
  let outDir: string
  let worker: string
  beforeAll(async () => {
    outDir = await mkdtemp(resolve(tmpdir(), 'omlr-pwa-'))
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    worker = await readFile(resolve(outDir, 'sw.js'), 'utf8')
  })
  afterAll(async () => { if (outDir) await rm(outDir, { recursive: true, force: true }) })

  it('生产清单覆盖入口和全部页面资源，并为每个文件提供 SHA-256 校验', async () => {
    // 构建产物是浏览器安装离线壳的输入。逐文件检查生产 worker 中的清单，
    // 防止迁移后遗漏未访问页面的懒脚本、图标或清单，或把版本摘要误当成下载完整性校验。
    // 安装、缓存路由和升级行为由真实浏览器回归验证。
    const entries = await readdir(outDir, { recursive: true, withFileTypes: true })
    const files = entries.filter((entry) => entry.isFile() && entry.name !== 'sw.js')
    expect(files.some((entry) => entry.name.startsWith('settings-'))).toBe(true)
    expect(files.some((entry) => entry.name.startsWith('type-templates-'))).toBe(true)
    for (const entry of files) {
      const path = resolve(entry.parentPath, entry.name)
      const integrity = 'sha256-' + createHash('sha256').update(await readFile(path)).digest('base64')
      expect(worker).toContain(integrity)
      if (entry.name !== 'index.html') expect(worker).toContain(entry.name)
    }
  })
})
