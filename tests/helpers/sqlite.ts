import { DatabaseSync } from 'node:sqlite'
import schema from '../../src/features/storage/schema.sql?raw'
import { SqliteStorage } from '../../src/features/storage/sqlite'
import type { SqlDriver, SqlRow } from '../../src/features/storage/type'

/** 测试实际运行共享 DDL 和 SQLite 事务，避免存储替身掩盖外键与排序问题。 */
export function createTestStorage() {
  const database = new DatabaseSync(':memory:')
  database.exec(schema)
  database.exec('PRAGMA foreign_keys=ON')
  const driver: SqlDriver = {
    async query(sql, values = []) { return database.prepare(sql).all(...values) as SqlRow[] },
    async execute(statements) {
      database.exec('BEGIN')
      try {
        for (const item of statements) database.prepare(item.sql).run(...(item.values ?? []))
        database.exec('COMMIT')
      } catch (error) { database.exec('ROLLBACK'); throw error }
    },
  }
  return { database, driver, storage: new SqliteStorage(driver) }
}
