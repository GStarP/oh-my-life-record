import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { workerHarness } from './helpers/service-worker'

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

describe('生产离线壳', () => {
  let outDir: string
  let worker: string
  beforeAll(async () => {
    outDir = await mkdtemp(resolve(tmpdir(), 'omlr-pwa-'))
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } })
    worker = await readFile(resolve(outDir, 'sw.js'), 'utf8')
  })
  afterAll(async () => { if (outDir) await rm(outDir, { recursive: true, force: true }) })

  it('安装包含全部页面脚本；导航网络一直 pending 时仍立即返回缓存', async () => {
    // 手机可能首次离线进入从未在线访问的设置/模板页。直接执行生产构建 worker，
    // 验证每个 JS 都在安装清单内；安装后把网络置为永远 pending，入口及所有
    // 脚本仍应从同一缓存交付，且完全不发网络请求，避免 splash 等网络结束。
    const harness = workerHarness(worker)
    await harness.lifecycle('install')
    const requests = harness.addAll.mock.calls[0][0]
    const precached = requests.map((request) => new URL(request.url).pathname)
    const scripts = (await readdir(resolve(outDir, 'assets'))).filter((file) => file.endsWith('.js'))
    expect(scripts.length).toBeGreaterThan(0)
    expect(precached).toEqual(expect.arrayContaining(scripts.map((file) => '/assets/' + file)))
    expect(precached).toContain('/index.html')
    // 安装时校验完整内容：部署切换中取得别的版本 HTML 或错误回退页，
    // 浏览器应拒绝安装，避免把新 HTML 与旧脚本拼成无法启动的版本。
    for (const request of requests) {
      const content = await readFile(resolve(outDir, new URL(request.url).pathname.slice(1)))
      expect(request.integrity).toBe('sha256-' + createHash('sha256').update(content).digest('base64'))
    }
    harness.network.mockClear().mockImplementation(() => new Promise(() => {}))
    const response = await harness.request('/records')
    expect(await response.text()).toBe('network')
    for (const script of scripts) await expect(harness.request('/assets/' + script, 'cors')).resolves.toBeInstanceOf(Response)
    expect(harness.network).not.toHaveBeenCalled()
  })

  it('更新安装失败保留旧版；成功安装也等待旧页面退出，不强制切换', async () => {
    // 只有完整版本才可用。失败的新 worker 不能激活或删除旧版 HTML/图片缓存；
    // 成功安装时也不能 skipWaiting 抢占仍在编辑的页面。浏览器允许激活后，
    // 才清理旧应用壳，且图片缓存必须保留。
    const stored = new Map([
      ['omlr-app-shell-old', new Map([['/index.html', new Response('old')]])],
      ['omlr-images-v1', new Map([['image', new Response('image')]])],
    ])
    const harness = workerHarness(worker, stored)
    harness.network.mockRejectedValueOnce(new TypeError('新资源下载失败'))
    await expect(harness.lifecycle('install')).rejects.toThrow('新资源下载失败')
    expect(stored.get('omlr-app-shell-old')?.has('/index.html')).toBe(true)
    expect(harness.claim).not.toHaveBeenCalled()
    await harness.lifecycle('install')
    expect(harness.skipWaiting).not.toHaveBeenCalled()
    expect(stored.has('omlr-app-shell-old')).toBe(true)
    await harness.lifecycle('activate')
    expect(stored.has('omlr-app-shell-old')).toBe(false)
    expect(stored.has('omlr-images-v1')).toBe(true)
  })
})
