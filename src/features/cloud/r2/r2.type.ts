import type { LifeRecord } from '../../records/type'

/** 云端 JSON 中 time 尚未反序列化为 Date 的记录形状。 */
export type RecordJson = Omit<LifeRecord, 'time'> & { time: string }
