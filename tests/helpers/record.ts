import type { LifeRecord } from '../../src/features/records/type'

/** 测试用记录夹具：默认值保持与领域模型的必填字段一致。 */
export function recordFixture(
  id: string,
  time: string,
  overrides: Partial<LifeRecord> = {},
): LifeRecord {
  return {
    id,
    time: new Date(time),
    type: '测试',
    name: '',
    description: '',
    images: [],
    attributes: {},
    ...overrides,
  }
}
