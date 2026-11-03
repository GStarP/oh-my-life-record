import type { SyncProgressDisplay, SyncProgressPublisher } from './progress.type'

const MINIMUM_STAGE_MS = 800

/** 阶段切换和关窗前留足阅读时间；同阶段的数量更新不重新计时。 */
export function createSyncProgressDisplay(publish: SyncProgressPublisher): SyncProgressDisplay {
  let stage: string | undefined
  let shownAt = 0
  async function finish() {
    if (stage === undefined) return
    const remaining = MINIMUM_STAGE_MS - (performance.now() - shownAt)
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.ceil(remaining)))
  }
  return {
    async update(progress) {
      if (progress.stage !== stage) {
        if (stage !== undefined) await finish()
        stage = progress.stage
        shownAt = performance.now()
      }
      publish(progress)
    },
    finish,
  }
}
