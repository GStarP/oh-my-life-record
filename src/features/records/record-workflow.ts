import type { ImageFile } from '../storage/type'
import type { RecordWorkflow, RecordWorkflowDependencies } from './record-workflow.type'

export function createRecordWorkflow({ storage, images }: RecordWorkflowDependencies): RecordWorkflow {
  return {
    async save(record, drafts = []) {
      const written: ImageFile[] = []
      let committed = false
      try {
        for (const image of drafts) if (record.images.includes(image.id)) written.push(await images.persist(image))
        const removed = await storage.saveRecord(record, written)
        committed = true
        await images.remove(removed).catch(() => {})
        for (const image of written) void images.source(image.id, true).catch(() => {})
      } finally {
        if (!committed) await images.remove(written).catch(() => {})
      }
    },
    async delete(record) {
      const removed = await storage.deleteRecord(record.id)
      await images.remove(removed).catch(() => {})
    },
  }
}
