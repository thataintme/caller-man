import notifee from '@notifee/react-native';
import * as Location from 'expo-location';
import { resolveStartupRoute, resetInitialNotificationCacheForTests } from './resolveStartupRoute';
import { getDb } from '../db/expoSqliteClient';
import { runMigrations } from '../db/migrations';
import { getActiveJourney, getJourneyById } from '../db/journeysRepo';
import { resumeMonitorsIfActive } from '../location/locationService';
import { Journey } from '../types/journey';

jest.mock('@notifee/react-native', () => ({
  getInitialNotification: jest.fn(),
  cancelAllNotifications: jest.fn(),
}));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
}));
const DB = { tag: 'db' };
jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn() }));
jest.mock('../db/migrations', () => ({ runMigrations: jest.fn() }));
jest.mock('../db/journeysRepo', () => ({ getActiveJourney: jest.fn(), getJourneyById: jest.fn() }));
jest.mock('../location/locationService', () => ({ resumeMonitorsIfActive: jest.fn() }));

const base: Journey = {
  id: 4, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: null, status: 'active',
  createdAt: 0, completedAt: null, arrivedAt: null,
};

function grant(fg: boolean, bg: boolean) {
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: fg, status: fg ? 'granted' : 'denied' });
  (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: bg, status: bg ? 'granted' : 'denied' });
}

function initialNotification(id: string) {
  (notifee.getInitialNotification as jest.Mock).mockResolvedValue({
    notification: { id },
    pressAction: { id: 'default' },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetInitialNotificationCacheForTests();
  (getDb as jest.Mock).mockResolvedValue(DB);
  (runMigrations as jest.Mock).mockResolvedValue(undefined);
  (resumeMonitorsIfActive as jest.Mock).mockResolvedValue(undefined);
  (notifee.getInitialNotification as jest.Mock).mockResolvedValue(null);
  (getActiveJourney as jest.Mock).mockResolvedValue(null);
  (getJourneyById as jest.Mock).mockResolvedValue(null);
  grant(true, true);
});

test('runs migrations, then resumes monitors exactly once, before deciding', async () => {
  await resolveStartupRoute();

  expect(runMigrations).toHaveBeenCalledWith(DB);
  expect(resumeMonitorsIfActive).toHaveBeenCalledTimes(1);
  const migrateOrder = (runMigrations as jest.Mock).mock.invocationCallOrder[0];
  const resumeOrder = (resumeMonitorsIfActive as jest.Mock).mock.invocationCallOrder[0];
  const decideOrder = (notifee.getInitialNotification as jest.Mock).mock.invocationCallOrder[0];
  expect(migrateOrder).toBeLessThan(resumeOrder);
  expect(resumeOrder).toBeLessThan(decideOrder);
});

test('an app launched from an alarm notification of a still-active journey opens that Alarm', async () => {
  initialNotification('gps-loss-4');
  (getJourneyById as jest.Mock).mockResolvedValue(base);
  // Even with permissions missing, the alarm takes precedence.
  grant(false, false);

  await expect(resolveStartupRoute()).resolves.toEqual({
    name: 'Alarm',
    params: { journeyId: 4, kind: 'gpsLoss' },
  });
  expect(getJourneyById).toHaveBeenCalledWith(DB, 4);
});

test('an initial alarm notification for a journey that is no longer active is ignored', async () => {
  initialNotification('arrival-4');
  (getJourneyById as jest.Mock).mockResolvedValue({ ...base, status: 'completed' });

  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'Journeys' });
});

test('an initial alarm notification for a missing journey is ignored', async () => {
  initialNotification('low-battery-99');
  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'Journeys' });
});

test('a non-alarm initial notification (e.g. the tracking service) is ignored', async () => {
  initialNotification('expo-location-foreground-service');
  (getActiveJourney as jest.Mock).mockResolvedValue(base);

  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'CurrentJourney', params: { journeyId: 4 } });
  expect(getJourneyById).not.toHaveBeenCalled();
});

test('a failing getInitialNotification falls through to the normal route', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  (notifee.getInitialNotification as jest.Mock).mockRejectedValue(new Error('native'));
  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'Journeys' });
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test.each([
  ['foreground', false, true],
  ['background', true, false],
  ['both', false, false],
])('routes to Welcome when %s location permission is not granted (check only, never request)', async (_l, fg, bg) => {
  grant(fg, bg);
  (getActiveJourney as jest.Mock).mockResolvedValue(base);

  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'Welcome' });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
});

test('with permissions granted and no active journey, routes to Journeys', async () => {
  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'Journeys' });
  expect(getActiveJourney).toHaveBeenCalledWith(DB);
});

test('with an active, un-arrived journey, routes to CurrentJourney', async () => {
  (getActiveJourney as jest.Mock).mockResolvedValue(base);
  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'CurrentJourney', params: { journeyId: 4 } });
});

test('with an active, arrived journey, routes to the arrival Alarm', async () => {
  (getActiveJourney as jest.Mock).mockResolvedValue({ ...base, arrivedAt: 1 });
  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'Alarm', params: { journeyId: 4, kind: 'arrival' } });
});

test('propagates a migration failure (App shows it with Retry)', async () => {
  (runMigrations as jest.Mock).mockRejectedValue(new Error('disk full'));
  await expect(resolveStartupRoute()).rejects.toThrow('disk full');
  expect(resumeMonitorsIfActive).not.toHaveBeenCalled();
});

test('a Retry after a later startup failure reuses the launching alarm notification (notifee returns it only once)', async () => {
  (notifee.getInitialNotification as jest.Mock)
    .mockResolvedValueOnce({ notification: { id: 'arrival-4' }, pressAction: { id: 'default' } })
    .mockResolvedValue(null);
  (getJourneyById as jest.Mock).mockRejectedValueOnce(new Error('db busy')).mockResolvedValue(base);

  await expect(resolveStartupRoute()).rejects.toThrow('db busy');
  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'Alarm', params: { journeyId: 4, kind: 'arrival' } });
  expect(notifee.getInitialNotification).toHaveBeenCalledTimes(1);
});

test('a failed getInitialNotification read is not cached, so Retry reads it again', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  (notifee.getInitialNotification as jest.Mock)
    .mockRejectedValueOnce(new Error('native'))
    .mockResolvedValue({ notification: { id: 'arrival-4' }, pressAction: { id: 'default' } });
  (getJourneyById as jest.Mock).mockResolvedValue(base);

  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'Journeys' });
  await expect(resolveStartupRoute()).resolves.toEqual({ name: 'Alarm', params: { journeyId: 4, kind: 'arrival' } });
  expect(notifee.getInitialNotification).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});
