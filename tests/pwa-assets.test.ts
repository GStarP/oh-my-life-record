import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const publicDir = resolve(process.cwd(), 'public')

describe('PWA 公共资源', () => {
  it('清单、安装图标和离线壳入口形成完整的可安装资源', async () => {
    // 这是浏览器判断应用能否安装的最小外部契约：入口必须回到记录页，
    // display 必须提供独立应用窗口，清单引用的图标、HTML 发现入口和
    // service worker 必须同时存在；不绑定 cache 名称等内部实现字符串。
    const manifest = JSON.parse(
      await readFile(resolve(publicDir, 'manifest.webmanifest'), 'utf8'),
    ) as {
      start_url?: string
      display?: string
      icons?: Array<{ src?: string; sizes?: string; type?: string }>
    }

    expect(manifest.start_url).toBe('/records')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/omlr-icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icons/omlr-icon-512.png', sizes: '512x512' }),
      ]),
    )

    for (const icon of manifest.icons ?? []) {
      await expect(stat(resolve(publicDir, icon.src?.slice(1) ?? ''))).resolves.toBeDefined()
    }

    const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon.png"')
    await expect(stat(resolve(publicDir, 'icons/favicon.png'))).resolves.toBeDefined()
    await expect(stat(resolve(publicDir, 'sw.js'))).resolves.toBeDefined()
  })
})
