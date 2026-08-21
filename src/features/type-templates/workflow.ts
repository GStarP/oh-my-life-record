/**
 * 类型模板的非 React 操作层。
 *
 * 页面只调用模板的增删改查，不直接组装 dirty 状态或绕过模板唯一性
 * 约束；IndexedDB 与未来其他存储实现都藏在 StorageAdapter 后面。
 */
import { normalizeTemplate, validateTemplate } from './model'
import type {
  TypeTemplateWorkflow,
  TypeTemplateWorkflowOptions,
} from './workflow.type'

export function createTypeTemplateWorkflow({
  storage,
}: TypeTemplateWorkflowOptions): TypeTemplateWorkflow {
  async function list() {
    const templates = await storage.getTypeTemplates()
    return templates.sort((left, right) => left.type.localeCompare(right.type))
  }

  return {
    list,
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
      await storage.putTypeTemplateAndMarkDirty(normalized)
    },
    remove: (type) => storage.deleteTypeTemplateAndMarkDirty(type),
  }
}
