import notifee from '@notifee/react-native';
import { dismissAlarm, snoozeAlarm, nextRouteAfterAlarm } from './alarmActions';
import { scheduleSnoozedAlert } from './alarmManager';
import { getJourneyById, finishJourney } from '../db/journeysRepo';
import { pruneFixesForJourney } from '../db/locationLogRepo';
import { stopTracking } from '../location/locationService';
import { Journey } from '../types/journey';

jest.mock('@notifee/react-native', () => ({
  cancelNotification: jest.fn().mockResolvedValue(undefined),
  cancelAllNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../db/expoSqliteClient', () => ({ getDb: jest.fn().mockResolvedValue({}) }));
jest.mock('../db/journeysRepo');
jest.mock('../db/locationLogRepo');
// Factory (not automock) so the real locationService -> backgroundTask ->
// expo-task-manager chain is never loaded here.
jest.mock('../location/locationService', () => ({ stopTracking: jest.fn().mockResolvedValue(undefined) }));
// Real alarmNotificationId/cancelAllAlertsForJourney (they only call the
// mocked notifee above); only the trigger scheduling is replaced.
jest.mock('./alarmManager', () => ({
  ...jest.requireActual('./alarmManager'),
  scheduleSnoozedAlert: jest.fn().mockResolvedValue(undefined),
}));

const journey: Journey = {
  id: 7, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: null, status: 'active',
  createdAt: 0, completedAt: null, arrivedAt: 123456,
};

// Every id silenced via either notifee cancel API, de-duplicated.
const cancelledIds = () =>
  [
    ...new Set([
      ...(notifee.cancelNotification as jest.Mock).mock.calls.map((c) => c[0] as string),
      ...(notifee.cancelAllNotifications as jest.Mock).mock.calls.flatMap((c) => c[0] as string[]),
    ]),
  ].sort();

beforeEach(() => {
  jest.clearAllMocks();
  (getJourneyById as jest.Mock).mockResolvedValue(journey);
});

describe('snoozeAlarm', () => {
  test.each([
    ['arrival', 'arrival-7'],
    ['gpsLoss', 'gps-loss-7'],
    ['lowBattery', 'low-battery-7'],
  ] as const)('%s: cancels the notification, then schedules a re-alert snoozeMinutes from now', async (kind, id) => {
    const before = Date.now();
    await snoozeAlarm(7, kind);

    expect(getJourneyById).toHaveBeenCalledWith(expect.anything(), 7);
    expect(notifee.cancelNotification).toHaveBeenCalledWith(id);
    expect(scheduleSnoozedAlert).toHaveBeenCalledTimes(1);
    const [snoozed, snoozedKind, atMs] = (scheduleSnoozedAlert as jest.Mock).mock.calls[0];
    expect(snoozed).toEqual(journey);
    expect(snoozedKind).toBe(kind);
    expect(atMs).toBeGreaterThanOrEqual(before + 3 * 60_000);
    expect(atMs).toBeLessThanOrEqual(Date.now() + 3 * 60_000);

    const cancelOrder = (notifee.cancelNotification as jest.Mock).mock.invocationCallOrder[0];
    const scheduleOrder = (scheduleSnoozedAlert as jest.Mock).mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(scheduleOrder);

    expect(finishJourney).not.toHaveBeenCalled();
    expect(stopTracking).not.toHaveBeenCalled();
  });

  test('stale (missing) journey: cancels the notification and does not schedule or throw', async () => {
    (getJourneyById as jest.Mock).mockResolvedValue(null);
    await expect(snoozeAlarm(7, 'gpsLoss')).resolves.toBeUndefined();
    expect(cancelledIds()).toContain('gps-loss-7');
    expect(scheduleSnoozedAlert).not.toHaveBeenCalled();
  });

  test('stale (finished) journey: cancels the notification and does not schedule', async () => {
    (getJourneyById as jest.Mock).mockResolvedValue({ ...journey, status: 'completed' });
    await snoozeAlarm(7, 'arrival');
    expect(cancelledIds()).toContain('arrival-7');
    expect(scheduleSnoozedAlert).not.toHaveBeenCalled();
  });

  test('propagates a scheduling failure', async () => {
    (scheduleSnoozedAlert as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(snoozeAlarm(7, 'arrival')).rejects.toThrow('boom');
  });
});

describe('dismissAlarm', () => {
  test('arrival: cancels all three alert ids, completes the journey, prunes fixes, stops tracking — in that order', async () => {
    await dismissAlarm(7, 'arrival');

    expect(cancelledIds()).toEqual(['arrival-7', 'gps-loss-7', 'low-battery-7']);
    expect(finishJourney).toHaveBeenCalledWith(expect.anything(), 7, 'completed');
    expect(pruneFixesForJourney).toHaveBeenCalledWith(expect.anything(), 7);
    expect(stopTracking).toHaveBeenCalledTimes(1);

    expect(notifee.cancelNotification).toHaveBeenCalledWith('arrival-7');
    const cancelOrders = [
      ...(notifee.cancelNotification as jest.Mock).mock.invocationCallOrder,
      ...(notifee.cancelAllNotifications as jest.Mock).mock.invocationCallOrder,
    ];
    const finishOrder = (finishJourney as jest.Mock).mock.invocationCallOrder[0];
    const pruneOrder = (pruneFixesForJourney as jest.Mock).mock.invocationCallOrder[0];
    const stopOrder = (stopTracking as jest.Mock).mock.invocationCallOrder[0];
    expect(Math.max(...cancelOrders)).toBeLessThan(finishOrder);
    expect(finishOrder).toBeLessThan(pruneOrder);
    expect(pruneOrder).toBeLessThan(stopOrder);
    expect(scheduleSnoozedAlert).not.toHaveBeenCalled();
  });

  test.each([
    ['gpsLoss', 'gps-loss-7'],
    ['lowBattery', 'low-battery-7'],
  ] as const)('%s: cancels only that notification and leaves the journey running', async (kind, id) => {
    await dismissAlarm(7, kind);
    expect(cancelledIds()).toEqual([id]);
    expect(notifee.cancelAllNotifications).not.toHaveBeenCalled();
    expect(finishJourney).not.toHaveBeenCalled();
    expect(pruneFixesForJourney).not.toHaveBeenCalled();
    expect(stopTracking).not.toHaveBeenCalled();
  });

  test('stale (missing) journey: cancels the notification and returns without finishing anything', async () => {
    (getJourneyById as jest.Mock).mockResolvedValue(null);
    await expect(dismissAlarm(7, 'arrival')).resolves.toBeUndefined();
    expect(cancelledIds()).toContain('arrival-7');
    expect(finishJourney).not.toHaveBeenCalled();
    expect(pruneFixesForJourney).not.toHaveBeenCalled();
    expect(stopTracking).not.toHaveBeenCalled();
  });

  test('stale (cancelled) journey: cancels the notification and returns without finishing anything', async () => {
    (getJourneyById as jest.Mock).mockResolvedValue({ ...journey, status: 'cancelled' });
    await dismissAlarm(7, 'lowBattery');
    expect(cancelledIds()).toContain('low-battery-7');
    expect(finishJourney).not.toHaveBeenCalled();
  });

  test('propagates a db failure', async () => {
    (finishJourney as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    await expect(dismissAlarm(7, 'arrival')).rejects.toThrow('db down');
    expect(stopTracking).not.toHaveBeenCalled();
  });
});

describe('nextRouteAfterAlarm', () => {
  test('arrival goes to Journeys', () => {
    expect(nextRouteAfterAlarm('arrival', 7)).toEqual({ name: 'Journeys' });
  });

  test.each(['gpsLoss', 'lowBattery'] as const)('%s goes back to Current Journey', (kind) => {
    expect(nextRouteAfterAlarm(kind, 7)).toEqual({ name: 'CurrentJourney', params: { journeyId: 7 } });
  });
});
