import { createInMemoryDb } from './testDb';
import { runMigrations } from './migrations';
import { getDefaultSettings, saveDefaultSettings } from './settingsRepo';

async function setup() {
  const db = createInMemoryDb();
  await runMigrations(db);
  return db;
}

test('getDefaultSettings reads the seeded row', async () => {
  const db = await setup();
  const settings = await getDefaultSettings(db);
  expect(settings).toEqual({
    radiusM: 10000,
    maxPollFreqPerMin: 20,
    minPollFreqPerMin: 5,
    alarmTune: 'Radar Ping',
    batteryCutoffPct: 15,
    snoozeMinutes: 3,
    gpsLossGraceMinutes: 2,
  });
});

test('saveDefaultSettings overwrites and getDefaultSettings reflects it', async () => {
  const db = await setup();
  await saveDefaultSettings(db, {
    radiusM: 20000,
    maxPollFreqPerMin: 30,
    minPollFreqPerMin: 10,
    alarmTune: 'Chime',
    batteryCutoffPct: 20,
    snoozeMinutes: 5,
    gpsLossGraceMinutes: 4,
  });
  const settings = await getDefaultSettings(db);
  expect(settings.radiusM).toBe(20000);
  expect(settings.alarmTune).toBe('Chime');
  expect(settings.snoozeMinutes).toBe(5);
});
