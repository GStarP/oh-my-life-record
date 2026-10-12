export type WorkerEvent = {
  request?: { url: string; method: string; mode: string }
  waitUntil: (promise: Promise<unknown>) => void
  respondWith: (promise: Promise<Response>) => void
}

export type WorkerListener = (event: WorkerEvent) => void

export type WorkerCaches = Map<string, Map<string, Response>>
