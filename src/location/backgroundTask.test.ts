import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { setLastAppliedIntervalMs } from './backgroundTask';
import { triggerAlarm, armGpsLossDeadline, cancelGpsLossAlert } from '../alarm/alarmManager';
import { getDb } from '../db/expoSqliteClient';
import { createInMemoryDb } from '../db/testDb';
import { runMigrations } from '../db/migrations';
import { createJourney, finishJourney, getJourneyById, markArrived } from '../db/journeysRepo';
import { getRecentFixes } from '../db/locationLogRepo';
import { Db } from '../db/types';
import { Journey } from '../types/journey';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
}));
jest.mock('../alarm/alarmManager', () => ({
  triggerAlarm: jest.fn(),
  armGpsLossDeadline: jest.fn(),
  cancelGpsLossAlert: jest.fn(),
}));
jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn() }));
// Real SQL (in-memory db below); markArrived is wrapped only so its call
// order relative to the alarm/notification calls can be asserted.
jest.mock('../db/journeysRepo', () => {
  const actual = jest.requireActual('../db/journeysRepo');
  return { ...actual, markArrived: jest.fn(actual.markArrived) };
});

type Executor = (body: { data: unknown; error: unknown }) => Promise<void>;
// Captured at import time, before any beforeEach clears the mock's calls.
const executor = (TaskManager.defineTask as jest.Mock).mock.calls[0][1] as Executor;

const input = {
  name: 'Station',
  destinationLat: 0,
  destinationLng: 0,
  radiusM: 200,
  maxPollFreqPerMin: 20,
  minPollFreqPerMin: 5, // -> 12s interval at/after the initial distance
  alarmTune: 'Radar Ping',
  batteryCutoffPct: 15,
  snoozeMinutes: 3,
  gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000,
};

const INSIDE_RADIUS_LAT = 0.0001; // ~11 m from (0,0)
const FAR_LAT = 0.2; // ~22 km: beyond initialDistanceM -> min frequency (12s)

let db: Db;
let errorSpy: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  db = createInMemoryDb();
  await runMigrations(db);
  (getDb as jest.Mock).mockResolvedValue(db);
  (Location.startLocationUpdatesAsync as jest.Mock).mockResolvedValue(undefined);
  (Location.stopLocationUpdatesAsync as jest.Mock).mockResolvedValue(undefined);
  (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
  (triggerAlarm as jest.Mock).mockResolvedValue(undefined);
  (armGpsLossDeadline as jest.Mock).mockResolvedValue(undefined);
  (cancelGpsLossAlert as jest.Mock).mockResolvedValue(undefined);
  setLastAppliedIntervalMs(12_000);
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

function fixAt(lat: number, timestamp = Date.now()) {
  return {
    data: { locations: [{ coords: { latitude: lat, longitude: 0, speed: 10, accuracy: 5 }, timestamp }] },
    error: null,
  };
}

async function reload(journey: Journey): Promise<Journey> {
  return (await getJourneyById(db, journey.id))!;
}

test('the task is registered under the shared task name', () => {
  expect(executor).toEqual(expect.any(Function));
});

describe('arrival', () => {
  test('displays the alarm, cancels the GPS-loss deadline, then marks arrived, then stops updates — in that order', async () => {
    const journey = await createJourney(db, input);
    const at = Date.now();
    await executor(fixAt(INSIDE_RADIUS_LAT, at));

    expect(triggerAlarm).toHaveBeenCalledWith(expect.objectContaining({ id: journey.id }));
    expect(cancelGpsLossAlert).toHaveBeenCalledWith(journey.id);
    expect((await reload(journey)).arrivedAt).toBe(at);
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(armGpsLossDeadline).not.toHaveBeenCalled();

    const { markArrived: markArrivedMock } = jest.requireMock('../db/journeysRepo');
    const alarmOrder = (triggerAlarm as jest.Mock).mock.invocationCallOrder[0];
    const cancelOrder = (cancelGpsLossAlert as jest.Mock).mock.invocationCallOrder[0];
    const arrivedOrder = (markArrivedMock as jest.Mock).mock.invocationCallOrder[0];
    const stopOrder = (Location.stopLocationUpdatesAsync as jest.Mock).mock.invocationCallOrder[0];
    expect(alarmOrder).toBeLessThan(cancelOrder);
    expect(cancelOrder).toBeLessThan(arrivedOrder);
    expect(arrivedOrder).toBeLessThan(stopOrder);
  });

  test('a triggerAlarm failure leaves arrivedAt null and keeps tracking, so the next fix retries', async () => {
    const journey = await createJourney(db, input);
    (triggerAlarm as jest.Mock).mockRejectedValueOnce(new Error('channel failure'));

    await executor(fixAt(INSIDE_RADIUS_LAT));

    expect((await reload(journey)).arrivedAt).toBeNull();
    expect(Location.stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Location task failed', expect.any(Error));

    await executor(fixAt(INSIDE_RADIUS_LAT));
    expect(triggerAlarm).toHaveBeenCalledTimes(2);
    expect((await reload(journey)).arrivedAt).not.toBeNull();
  });

  test('an already-arrived journey tears down without re-alarming or recording the fix', async () => {
    const journey = await createJourney(db, input);
    await markArrived(db, journey.id, 1234);

    await executor(fixAt(INSIDE_RADIUS_LAT));

    expect(triggerAlarm).not.toHaveBeenCalled();
    expect(armGpsLossDeadline).not.toHaveBeenCalled();
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(await getRecentFixes(db, journey.id, 0)).toHaveLength(0);
  });
});

test('with no active journey, location updates are stopped', async () => {
  await executor(fixAt(FAR_LAT));
  expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  expect(triggerAlarm).not.toHaveBeenCalled();
  expect(armGpsLossDeadline).not.toHaveBeenCalled();
});

test('an empty locations batch is ignored', async () => {
  await createJourney(db, input);
  await executor({ data: { locations: [] }, error: null });
  expect(getDb).not.toHaveBeenCalled();
});

test('a task error is logged and nothing else happens', async () => {
  await executor({ data: null, error: new Error('boom') });
  expect(errorSpy).toHaveBeenCalledWith('Location task error', expect.any(Error));
  expect(getDb).not.toHaveBeenCalled();
});

describe('continuing fixes', () => {
  test('records the fix and last-fix time', async () => {
    const journey = await createJourney(db, input);
    const at = Date.now();
    await executor(fixAt(FAR_LAT, at));
    expect((await reload(journey)).lastFixAt).toBe(at);
    expect(await getRecentFixes(db, journey.id, 0)).toHaveLength(1);
    expect(triggerAlarm).not.toHaveBeenCalled();
  });

  test('C1: every fix re-arms the GPS-loss deadline at fix time + current interval + grace, pushing it forward', async () => {
    const journey = await createJourney(db, input);
    const first = Date.now();
    await executor(fixAt(FAR_LAT, first));
    await executor(fixAt(FAR_LAT, first + 12_000));

    expect(armGpsLossDeadline).toHaveBeenCalledTimes(2);
    const calls = (armGpsLossDeadline as jest.Mock).mock.calls;
    expect(calls[0][0]).toEqual(expect.objectContaining({ id: journey.id }));
    expect(calls[0][1]).toBe(first + 12_000 + 120_000);
    expect(calls[1][1]).toBe(first + 12_000 + 12_000 + 120_000);
  });

  test('C1: the deadline uses the newly applied interval when this fix reschedules updates', async () => {
    await createJourney(db, input);
    setLastAppliedIntervalMs(3_000);
    const at = Date.now();
    await executor(fixAt(FAR_LAT, at));
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalled();
    expect(armGpsLossDeadline).toHaveBeenCalledWith(expect.anything(), at + 12_000 + 120_000);
  });

  test('C1: if the journey is cancelled while the fix is being handled, its GPS-loss deadline is cancelled and updates stop', async () => {
    const journey = await createJourney(db, input);
    (armGpsLossDeadline as jest.Mock).mockImplementationOnce(async () => {
      await finishJourney(db, journey.id, 'cancelled');
    });

    await executor(fixAt(FAR_LAT));

    expect(cancelGpsLossAlert).toHaveBeenCalledWith(journey.id);
    const armOrder = (armGpsLossDeadline as jest.Mock).mock.invocationCallOrder[0];
    const cancelOrder = (cancelGpsLossAlert as jest.Mock).mock.invocationCallOrder[0];
    expect(armOrder).toBeLessThan(cancelOrder);
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });
});

describe('reschedule threshold (10%)', () => {
  test('does not restart updates when the new interval is within 10% of the applied one', async () => {
    await createJourney(db, input);
    setLastAppliedIntervalMs(11_500); // 12s is ~4% away
    await executor(fixAt(FAR_LAT));
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  test('does not restart updates when the interval is unchanged', async () => {
    await createJourney(db, input);
    await executor(fixAt(FAR_LAT));
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  test('restarts updates (with a refreshed remaining-distance notification) when the interval changes by >= 10%', async () => {
    await createJourney(db, input);
    setLastAppliedIntervalMs(10_000); // 12s is 20% away
    await executor(fixAt(FAR_LAT));
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
    const [taskName, options] = (Location.startLocationUpdatesAsync as jest.Mock).mock.calls[0];
    expect(taskName).toBe('caller-man-location-task');
    expect(options).toEqual({
      accuracy: 3,
      timeInterval: 12_000,
      foregroundService: {
        notificationTitle: 'Caller Man — tracking active',
        notificationBody: expect.stringMatching(/^22\.\d km remaining to Station$/),
      },
      pausesUpdatesAutomatically: false,
    });

    // The new interval is now the applied one: an identical next fix doesn't restart again.
    await executor(fixAt(FAR_LAT));
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });
});
