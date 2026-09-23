import * as SQLite from 'expo-sqlite';
import { Db } from './types';

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('callerman.db').then((sqliteDb) => ({
      execAsync: (sql: string) => sqliteDb.execAsync(sql),
      runAsync: (sql: string, params: unknown[] = []) =>
        sqliteDb.runAsync(sql, params as SQLite.SQLiteBindParams),
      getAllAsync: <T,>(sql: string, params: unknown[] = []) =>
        sqliteDb.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams),
      getFirstAsync: <T,>(sql: string, params: unknown[] = []) =>
        sqliteDb.getFirstAsync<T>(sql, params as SQLite.SQLiteBindParams),
    }));
  }
  return dbPromise;
}
