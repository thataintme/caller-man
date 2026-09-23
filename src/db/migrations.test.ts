import { createInMemoryDb } from './testDb';
import { runMigrations } from './migrations';

test('migrations create the expected tables and seed default_settings', async () => {
  const db = createInMemoryDb();
  await runMigrations(db);

  const journeyTables = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('journeys', 'default_settings', 'location_log')`
  );
  expect(journeyTables.map((t) => t.name).sort()).toEqual([
    'default_settings',
    'journeys',
    'location_log',
  ]);

  const settings = await db.getFirstAsync<{ radius_m: number }>(
    `SELECT radius_m FROM default_settings WHERE id = 1`
  );
  expect(settings?.radius_m).toBe(10000);
});

test('running migrations twice is safe (idempotent)', async () => {
  const db = createInMemoryDb();
  await runMigrations(db);
  await expect(runMigrations(db)).resolves.not.toThrow();
});
