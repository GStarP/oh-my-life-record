/** 记录业务使用的数据类型。 */

/**
 * 一条生活记录。time 为 Date 绝对瞬间；UTC+8 只用于月份归属与展示（见 ADR-0006）。
 * TS 中命名为 LifeRecord：避免与内置工具类型 Record<K,V> 冲突。
 *
 * name / description / images / attributes 均为必填字段，不区分「不存在」与「空值」：
 * 无名称或描述即空字符串、无图即空数组、无属性即空对象。
 */
export type LifeRecord = {
  /** 不可变唯一 ID（ULID）。 */
  id: string
  /** 记录时刻（绝对瞬间）。月份归属按固定 UTC+8 换算（ADR-0003/0006），由 date-fns-tz 完成。 */
  time: Date
  /** 自由文本分类，无预置模板、无属性 schema 约束。 */
  type: string
  /** 简短名称；未填写时为空字符串，与完整描述独立保存。 */
  name: string
  /** 描述；无描述为空字符串。 */
  description: string
  /** 图片 ID 引用列表；同一图片可被多条记录共享，S3 只存一份。无图为空数组。 */
  images: string[]
  /** 用户自定义属性，值仅允许 string / number / boolean。无属性为空对象。 */
  attributes: { [key: string]: string | number | boolean }
}

/** 一张图片的云端/本地标识。与记录 ID 同用不可变 ULID，命名空间独立。 */
export type ImageId = string
