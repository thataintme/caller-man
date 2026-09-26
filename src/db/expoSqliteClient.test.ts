import * as SQLite from 'expo-sqlite';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

const fakeSqliteDb = {
  execAsync: jest.fn(),
  runAsync: jest.fn(),
  getAllAsync: jest.fn(),
  getFirstAsync: jest.fn(),
};

// Fresh module per test: getDb caches its promise at module scope.
function loadGetDb(): typeof import('./expoSqliteClient').getDb {
  let getDb!: typeof import('./expoSqliteClient').getDb;
  jest.isolateModules(() => {
    getDb = require('./expoSqliteClient').getDb;
  });
  return getDb;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('opens the database once and reuses it', async () => {
  (SQLite.openDatabaseAsync as jest.Mock).mockResolvedValue(fakeSqliteDb);
  const getDb = loadGetDb();
  const first = await getDb();
  const second = await getDb();
  expect(first).toBe(second);
  expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);
  expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith('callerman.db');
});

test('M6: a failed open is not cached, so a later call (Retry) can recover', async () => {
  (SQLite.openDatabaseAsync as jest.Mock)
    .mockRejectedValueOnce(new Error('disk I/O error'))
    .mockResolvedValueOnce(fakeSqliteDb);
  const getDb = loadGetDb();

  await expect(getDb()).rejects.toThrow('disk I/O error');
  const db = await getDb();

  expect(SQLite.openDatabaseAsync).toHaveBeenCalledTimes(2);
  await db.execAsync('SELECT 1');
  expect(fakeSqliteDb.execAsync).toHaveBeenCalledWith('SELECT 1');
});
