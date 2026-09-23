import { createInMemoryDb } from './testDb';
import { runMigrations } from './migrations';
import { insertFix, getRecentFixes, pruneFixesForJourney } from './locationLogRepo';
import { createJourney } from './journeysRepo';

async function setupWithJourney() {
  const db = createInMemoryDb();
  await runMigrations(db);
  const journey = await createJourney(db, {
    name: 'Home', destinationLat: 51.5, destinationLng: -0.12, radiusM: 1000,
    maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
    batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2, initialDistanceM: 5000,
  });
  return { db, journey };
}

test('insertFix and getRecentFixes round-trip in chronological order', async () => {
  const { db, journey } = await setupWithJourney();
  await insertFix(db, journey.id, 51.4, -0.1, 5, 10, 1000);
  await insertFix(db, journey.id, 51.41, -0.1, 6, 10, 2000);

  const fixes = await getRecentFixes(db, journey.id, 0);
  expect(fixes.map((f) => f.recordedAt)).toEqual([1000, 2000]);
});

test('getRecentFixes excludes fixes before the given timestamp', async () => {
  const { db, journey } = await setupWithJourney();
  await insertFix(db, journey.id, 51.4, -0.1, 5, 10, 1000);
  await insertFix(db, journey.id, 51.41, -0.1, 6, 10, 5000);

  const fixes = await getRecentFixes(db, journey.id, 3000);
  expect(fixes.map((f) => f.recordedAt)).toEqual([5000]);
});

test('pruneFixesForJourney deletes all fixes for that journey', async () => {
  const { db, journey } = await setupWithJourney();
  await insertFix(db, journey.id, 51.4, -0.1, 5, 10, 1000);
  await pruneFixesForJourney(db, journey.id);

  const fixes = await getRecentFixes(db, journey.id, 0);
  expect(fixes).toEqual([]);
});
