import { createInMemoryDb } from './testDb';
import { runMigrations } from './migrations';
import {
  createJourney,
  getActiveJourney,
  getJourneyById,
  listJourneys,
  finishJourney,
  updateLastFixAt,
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
