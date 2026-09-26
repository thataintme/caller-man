import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { startTracking, stopTracking, resumeMonitorsIfActive, requestPermissions } from './locationService';
import { setLastAppliedIntervalMs } from './backgroundTask';
import { armGpsLossDeadline, triggerLowBatteryAlert } from '../alarm/alarmManager';
import { getDb } from '../db/expoSqliteClient';
import { createInMemoryDb } from '../db/testDb';
import { runMigrations } from '../db/migrations';
import { createJourney, updateLastFixAt, markArrived, getJourneyById } from '../db/journeysRepo';
import { Db } from '../db/types';
import { Journey } from '../types/journey';

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
}));
jest.mock('expo-battery', () => ({ addBatteryLevelListener: jest.fn() }));
// Factory: the real module defines the expo-task-manager task on import.
jest.mock('./backgroundTask', () => ({ setLastAppliedIntervalMs: jest.fn() }));
jest.mock('../alarm/alarmManager', () => ({
  armGpsLossDeadline: jest.fn(),
  triggerLowBatteryAlert: jest.fn(),
}));
jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn() }));

const input = {
  name: 'Station',
  destinationLat: 0,
  destinationLng: 0,
  radiusM: 200,
  maxPollFreqPerMin: 20,
  minPollFreqPerMin: 5, // -> 12s interval
  alarmTune: 'Radar Ping',
  batteryCutoffPct: 15,
  snoozeMinutes: 3,
  gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000,
};

let db: Db;
let batteryListener: ((e: { batteryLevel: number }) => void) | null;
const removeSubscription = jest.fn();

beforeEach(async () => {
  jest.clearAllMocks();
  db = createInMemoryDb();
  await runMigrations(db);
  (getDb as jest.Mock).mockResolvedValue(db);
  (Location.startLocationUpdatesAsync as jest.Mock).mockResolvedValue(undefined);
  (Location.stopLocationUpdatesAsync as jest.Mock).mockResolvedValue(undefined);
  (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);
  (armGpsLossDeadline as jest.Mock).mockResolvedValue(undefined);
  (triggerLowBatteryAlert as jest.Mock).mockResolvedValue(undefined);
  batteryListener = null;
  (Battery.addBatteryLevelListener as jest.Mock).mockImplementation((listener) => {
    batteryListener = listener;
    return { remove: removeSubscription };
  });
});

afterEach(async () => {
  await stopTracking();
});

async function newJourney(): Promise<Journey> {
  return createJourney(db, input);
}

describe('startTracking', () => {
  test('starts location updates at the min-frequency interval with the shared foreground-service options (remaining distance, §5.6)', async () => {
    const journey = await newJourney();
    await startTracking(journey);
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith('caller-man-location-task', {
      accuracy: 3,
      timeInterval: 12_000,
      foregroundService: {
        notificationTitle: 'Caller Man — tracking active',
        notificationBody: '10.0 km remaining to Station',
      },
      pausesUpdatesAutomatically: false,
    });
    expect(setLastAppliedIntervalMs).toHaveBeenCalledWith(12_000);
  });

  test('C1: arms the GPS-loss deadline at createdAt + current interval + grace', async () => {
    const journey = await newJourney();
    await startTracking(journey);
    expect(armGpsLossDeadline).toHaveBeenCalledTimes(1);
    expect(armGpsLossDeadline).toHaveBeenCalledWith(journey, journey.createdAt + 12_000 + 120_000);
  });

  test('C1: no JS interval timer is started (timers are paused while the app is backgrounded/locked)', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    try {
      await startTracking(await newJourney());
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});

describe('low-battery listener', () => {
  test('alerts once when the battery reaches the cutoff, not again on later drops', async () => {
    const journey = await newJourney();
    await startTracking(journey);
    batteryListener!({ batteryLevel: 0.5 });
    expect(triggerLowBatteryAlert).not.toHaveBeenCalled();
    batteryListener!({ batteryLevel: 0.15 });
    batteryListener!({ batteryLevel: 0.1 });
    expect(triggerLowBatteryAlert).toHaveBeenCalledTimes(1);
    expect(triggerLowBatteryAlert).toHaveBeenCalledWith(journey);
  });

  test('ignores the unknown (-1) battery level', async () => {
    await startTracking(await newJourney());
    batteryListener!({ batteryLevel: -1 });
    expect(triggerLowBatteryAlert).not.toHaveBeenCalled();
  });

  test('stopTracking removes the listener and stops started updates', async () => {
    await startTracking(await newJourney());
    await stopTracking();
    expect(removeSubscription).toHaveBeenCalled();
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('caller-man-location-task');
  });
});

describe('resumeMonitorsIfActive', () => {
  test('C1: re-arms the GPS-loss deadline from the latest fix, using the (longest) min-frequency interval', async () => {
    const created = await newJourney();
    const lastFixAt = Date.now();
    await updateLastFixAt(db, created.id, lastFixAt);

    await resumeMonitorsIfActive();

    expect(armGpsLossDeadline).toHaveBeenCalledTimes(1);
    const journey = await getJourneyById(db, created.id);
    expect(armGpsLossDeadline).toHaveBeenCalledWith(journey, lastFixAt + 12_000 + 120_000);
    expect(Battery.addBatteryLevelListener).toHaveBeenCalledTimes(1);
  });

  test('C1: does not re-arm a deadline that already passed (it already fired, or a snooze of it is pending)', async () => {
    const created = await newJourney();
    await updateLastFixAt(db, created.id, Date.now() - 60 * 60_000);
    await resumeMonitorsIfActive();
    expect(armGpsLossDeadline).not.toHaveBeenCalled();
    expect(Battery.addBatteryLevelListener).toHaveBeenCalledTimes(1);
  });

  test('does nothing without an active journey', async () => {
    await resumeMonitorsIfActive();
    expect(armGpsLossDeadline).not.toHaveBeenCalled();
    expect(Battery.addBatteryLevelListener).not.toHaveBeenCalled();
  });

  test('does nothing for an already-arrived journey', async () => {
    const created = await newJourney();
    await markArrived(db, created.id, Date.now());
    await resumeMonitorsIfActive();
    expect(armGpsLossDeadline).not.toHaveBeenCalled();
    expect(Battery.addBatteryLevelListener).not.toHaveBeenCalled();
  });

  test('never touches location updates', async () => {
    await newJourney();
    await resumeMonitorsIfActive();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });
});

test('requestPermissions requires foreground then background permission', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  expect(await requestPermissions()).toBe(false);
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  expect(await requestPermissions()).toBe(false);
  expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
});
