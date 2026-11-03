import { withDeadline } from '../../utils/deadline'
import { registerPlugin } from '@capacitor/core'
import type { NativeDataPlugin } from './native.type'
import type { SqlDriver } from './type'

export const nativeData = registerPlugin<NativeDataPlugin>('LocalData')
export const nativeSql: SqlDriver = {
  async query(sql, values = [], path) { return (await withDeadline(nativeData.query({ sql, values, path }), 30_000, '数据库读取超时')).rows },
  async execute(statements, operationId) { await nativeData.execute({ statements, operationId }) },
}
