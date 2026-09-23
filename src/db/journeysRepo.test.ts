import { createInMemoryDb } from './testDb';
import { runMigrations } from './migrations';
import {
  createJourney,
  getActiveJourney,
  getJourneyById,
  listJourneys,
  finishJourney,
  updateLastFixAt,
  markArrived,
  ActiveJourneyExistsError,
} from './journeysRepo';

async function setup() {
  const db = createInMemoryDb();
  await runMigrations(db);
  return db;
}

const baseInput = {
  name: 'Home',
  destinationLat: 51.5,
  destinationLng: -0.12,
  radiusM: 1000,
  maxPollFreqPerMin: 20,
  minPollFreqPerMin: 5,
  alarmTune: 'Radar Ping',
  batteryCutoffPct: 15,
  snoozeMinutes: 3,
  gpsLossGraceMinutes: 2,
  initialDistanceM: 5000,
};

test('createJourney persists and returns the journey as active', async () => {
  const db = await setup();
  const journey = await createJourney(db, baseInput);
  expect(journey.status).toBe('active');
  expect(journey.id).toBeGreaterThan(0);
  expect(journey.lastFixAt).toBeNull();
});

test('createJourney rejects a second active journey', async () => {
  const db = await setup();
  await createJourney(db, baseInput);
  await expect(createJourney(db, baseInput)).rejects.toBeInstanceOf(ActiveJourneyExistsError);
});

test('createJourney is allowed again after the active one finishes', async () => {
  const db = await setup();
  const first = await createJourney(db, baseInput);
  await finishJourney(db, first.id, 'completed');
  await expect(createJourney(db, baseInput)).resolves.toBeDefined();
});

test('listJourneys returns newest first', async () => {
  const db = await setup();
  const a = await createJourney(db, baseInput);
  await finishJourney(db, a.id, 'completed');
  const b = await createJourney(db, baseInput);
  const list = await listJourneys(db);
  expect(list.map((j) => j.id)).toEqual([b.id, a.id]);
});

test('getActiveJourney returns null when none active', async () => {
  const db = await setup();
  expect(await getActiveJourney(db)).toBeNull();
});

test('getJourneyById returns the matching journey', async () => {
  const db = await setup();
  const created = await createJourney(db, baseInput);
  const fetched = await getJourneyById(db, created.id);
  expect(fetched?.id).toBe(created.id);
});

test('updateLastFixAt persists the timestamp', async () => {
  const db = await setup();
  const journey = await createJourney(db, baseInput);
  await updateLastFixAt(db, journey.id, 123456);
  const fetched = await getJourneyById(db, journey.id);
  expect(fetched?.lastFixAt).toBe(123456);
});

test('concurrent createJourney calls enforce single active via UNIQUE constraint', async () => {
  const db = await setup();
  const results = await Promise.allSettled([
    createJourney(db, baseInput),
    createJourney(db, baseInput),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0].status).toBe('rejected');
  if (rejected[0].status === 'rejected') {
    expect(rejected[0].reason).toBeInstanceOf(ActiveJourneyExistsError);
  }

  const active = await getActiveJourney(db);
  expect(active).not.toBeNull();
  const allJourneys = await listJourneys(db);
  const activeCount = allJourneys.filter((j) => j.status === 'active').length;
  expect(activeCount).toBe(1);
});

test('finishJourney does not re-finish an already finished journey', async () => {
  const db = await setup();
  const journey = await createJourney(db, baseInput);
  const beforeFirstFinish = Date.now();
  await finishJourney(db, journey.id, 'completed');
  const firstFinish = await getJourneyById(db, journey.id);
  expect(firstFinish?.status).toBe('completed');
  const firstCompletedAt = firstFinish?.completedAt;

  // Wait a tiny bit to ensure timestamps would differ if the update occurred
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Try to finish again with a different status
  await finishJourney(db, journey.id, 'cancelled');
  const afterSecondFinish = await getJourneyById(db, journey.id);

  // Should still be 'completed' and completedAt should be unchanged
  expect(afterSecondFinish?.status).toBe('completed');
  expect(afterSecondFinish?.completedAt).toBe(firstCompletedAt);
});

test('markArrived sets arrivedAt on an active journey, once', async () => {
  const db = await setup();
  const journey = await createJourney(db, baseInput);
  expect(journey.arrivedAt).toBeNull();

  await markArrived(db, journey.id, 999);
  const afterFirst = await getJourneyById(db, journey.id);
  expect(afterFirst?.arrivedAt).toBe(999);

  // A second call with a different timestamp must not overwrite the first arrival.
  await markArrived(db, journey.id, 1000);
  const afterSecond = await getJourneyById(db, journey.id);
  expect(afterSecond?.arrivedAt).toBe(999);
});

test('markArrived does not set arrivedAt on a finished journey', async () => {
  const db = await setup();
  const journey = await createJourney(db, baseInput);
  await finishJourney(db, journey.id, 'completed');

  await markArrived(db, journey.id, 999);
  const fetched = await getJourneyById(db, journey.id);
  expect(fetched?.arrivedAt).toBeNull();
});
