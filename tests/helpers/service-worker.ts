import { runInNewContext } from 'node:vm'
import { vi } from 'vitest'
import type { WorkerCaches, WorkerListener } from './service-worker.type'

/** 执行真实构建 worker，只替换浏览器宿主 API；生命周期由测试显式推进。 */
export function workerHarness(source: string, stored: WorkerCaches = new Map()) {
  const handlers = new Map<string, WorkerListener>()
  const network = vi.fn(async (_url: unknown) => new Response('network'))
  const skipWaiting = vi.fn()
  const claim = vi.fn()
  const addAll = vi.fn(async (requests: Request[]) => {
    return Promise.all(requests.map(async (request) =>
      [new URL(request.url).pathname, await network(request)] as const))
  })
  const caches = {
    keys: async () => [...stored.keys()],
    delete: async (name: string) => stored.delete(name),
    open: async (name: string) => {
      if (!stored.has(name)) stored.set(name, new Map())
      const entries = stored.get(name)!
      return {
        addAll: async (requests: Request[]) => {
          // 与浏览器一样，所有资源成功后才一次性写入；失败不留下半套 HTML。
          for (const [url, response] of await addAll(requests)) entries.set(url, response)
        },
        match: async (request: string | { url: string }) =>
          entries.get(typeof request === 'string' ? request : new URL(request.url).pathname)?.clone(),
      }
    },
  }
  runInNewContext(source, {
    self: { location: { origin: 'https://app.invalid' }, skipWaiting, clients: { claim },
      addEventListener: (name: string, listener: WorkerListener) => handlers.set(name, listener) },
    caches, fetch: network, URL, Request, Response, AbortController, setTimeout, clearTimeout,
  })
  return {
    stored, network, addAll, skipWaiting, claim,
    lifecycle(name: 'install' | 'activate') {
      let pending: Promise<unknown> | undefined
      handlers.get(name)!({ waitUntil: (promise) => { pending = promise }, respondWith: () => {} })
      return pending!
    },
    request(path: string, mode = 'navigate') {
      let pending: Promise<Response> | undefined
      handlers.get('fetch')!({ request: { url: 'https://app.invalid' + path, method: 'GET', mode },
        waitUntil: () => {}, respondWith: (promise) => { pending = promise } })
      return pending!
    },
  }
}
