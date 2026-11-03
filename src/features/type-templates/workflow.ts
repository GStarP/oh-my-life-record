import { normalizeTemplate, validateTemplate } from './model'
import type {
  TypeTemplateWorkflow,
  TypeTemplateWorkflowOptions,
} from './workflow.type'

export function createTypeTemplateWorkflow({
  storage,
}: TypeTemplateWorkflowOptions): TypeTemplateWorkflow {
  return {
    list: () => storage.getTypeTemplates(),
    find: (type) => storage.getTypeTemplate(type),
    async save(template, editingType) {
      const normalized = normalizeTemplate(template)
      if (editingType !== undefined && normalized.type !== editingType) {
        throw new Error('模板类型不能修改，请删除后重新创建')
      }
      const existing = await storage.getTypeTemplates()
      const validationError = validateTemplate(
        normalized,
        existing.map((item) => item.type),
        editingType,
      )
      if (validationError) throw new Error(validationError)
      await storage.saveTypeTemplate(normalized)
    },
    remove: (type) => storage.deleteTypeTemplate(type),
  }
}
