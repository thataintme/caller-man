import notifee from '@notifee/react-native';
import {
  triggerAlarm,
  triggerGpsLossAlert,
  triggerLowBatteryAlert,
  scheduleSnoozedAlert,
  alarmNotificationId,
  parseAlarmNotificationId,
  cancelAllAlertsForJourney,
  AlarmKind,
} from './alarmManager';
import { Journey } from '../types/journey';

jest.mock('@notifee/react-native', () => ({
  createChannel: jest.fn().mockResolvedValue('caller-man-alarm'),
  displayNotification: jest.fn().mockResolvedValue('notif-id'),
  createTriggerNotification: jest.fn().mockResolvedValue('notif-id'),
  getNotificationSettings: jest.fn(),
  cancelAllNotifications: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 4 },
  AndroidVisibility: { PUBLIC: 1 },
  AndroidCategory: { ALARM: 'alarm' },
  TriggerType: { TIMESTAMP: 0 },
  AlarmType: { SET: 0, SET_AND_ALLOW_WHILE_IDLE: 1, SET_EXACT: 2, SET_EXACT_AND_ALLOW_WHILE_IDLE: 3, SET_ALARM_CLOCK: 4 },
  AndroidNotificationSetting: { NOT_SUPPORTED: -1, DISABLED: 0, ENABLED: 1 },
}));

const journey: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: null, status: 'active',
  createdAt: 0, completedAt: null, arrivedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (notifee.getNotificationSettings as jest.Mock).mockResolvedValue({ android: { alarm: 1 } });
});

const SNOOZE_DISMISS_ACTIONS = [
  { title: 'Snooze', pressAction: { id: 'snooze' } },
  { title: 'Dismiss', pressAction: { id: 'dismiss' } },
];

test('triggerAlarm displays a full-screen, DND-bypassing ALARM-category notification', async () => {
  await triggerAlarm(journey);
  expect(notifee.createChannel).toHaveBeenCalledWith(expect.objectContaining({ bypassDnd: true }));
  expect(notifee.displayNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'arrival-1',
      android: expect.objectContaining({
        category: 'alarm',
        fullScreenAction: { id: 'default' },
        loopSound: true,
        pressAction: { id: 'default' },
        actions: SNOOZE_DISMISS_ACTIONS,
      }),
    })
  );
});

test('triggerGpsLossAlert displays a full-screen, looping alert with GPS-loss messaging', async () => {
  await triggerGpsLossAlert(journey);
  expect(notifee.displayNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'gps-loss-1',
      title: 'Lost GPS signal',
      android: expect.objectContaining({
        loopSound: true,
        pressAction: { id: 'default' },
        actions: SNOOZE_DISMISS_ACTIONS,
      }),
    })
  );
});

test('triggerLowBatteryAlert displays a full-screen, looping alert with low-battery messaging', async () => {
  await triggerLowBatteryAlert(journey);
  expect(notifee.displayNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'low-battery-1',
      title: 'Battery running low',
      android: expect.objectContaining({
        loopSound: true,
        pressAction: { id: 'default' },
        actions: SNOOZE_DISMISS_ACTIONS,
      }),
    })
  );
});

test('scheduleSnoozedAlert creates a timestamp trigger notification with the same id and presentation as the arrival alarm', async () => {
  const atMs = Date.now() + 3 * 60_000;
  await scheduleSnoozedAlert(journey, 'arrival', atMs);

  expect(notifee.createChannel).toHaveBeenCalledWith(expect.objectContaining({ bypassDnd: true }));
  expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'arrival-1',
      title: "You've arrived",
      android: expect.objectContaining({
        category: 'alarm',
        fullScreenAction: { id: 'default' },
        loopSound: true,
        pressAction: { id: 'default' },
        actions: SNOOZE_DISMISS_ACTIONS,
      }),
    }),
    { type: 0, timestamp: atMs, alarmManager: { type: 4 } }
  );
});

test('scheduleSnoozedAlert uses the gps-loss id and messaging when snoozing a gps-loss alert', async () => {
  const atMs = Date.now() + 5 * 60_000;
  await scheduleSnoozedAlert(journey, 'gpsLoss', atMs);

  expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'gps-loss-1',
      title: 'Lost GPS signal',
    }),
    { type: 0, timestamp: atMs, alarmManager: { type: 4 } }
  );
});

test('scheduleSnoozedAlert uses an exact SET_ALARM_CLOCK trigger when the exact-alarm permission is enabled', async () => {
  (notifee.getNotificationSettings as jest.Mock).mockResolvedValue({ android: { alarm: 1 } });
  const atMs = Date.now() + 3 * 60_000;

  await scheduleSnoozedAlert(journey, 'arrival', atMs);

  expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'arrival-1' }),
    { type: 0, timestamp: atMs, alarmManager: { type: 4 } }
  );
});

test.each([
  ['DISABLED', 0],
  ['NOT_SUPPORTED', -1],
])(
  'scheduleSnoozedAlert falls back to a non-exact trigger when the exact-alarm permission is %s',
  async (_label, alarmSetting) => {
    (notifee.getNotificationSettings as jest.Mock).mockResolvedValue({ android: { alarm: alarmSetting } });
    const atMs = Date.now() + 3 * 60_000;

    await scheduleSnoozedAlert(journey, 'arrival', atMs);

    expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'arrival-1' }),
      { type: 0, timestamp: atMs, alarmManager: { type: 1 } }
    );
  }
);

test('scheduleSnoozedAlert falls back to a non-exact trigger when getNotificationSettings rejects', async () => {
  (notifee.getNotificationSettings as jest.Mock).mockRejectedValue(new Error('native module unavailable'));
  const atMs = Date.now() + 3 * 60_000;

  await scheduleSnoozedAlert(journey, 'arrival', atMs);

  expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'arrival-1' }),
    { type: 0, timestamp: atMs, alarmManager: { type: 1 } }
  );
});

describe('parseAlarmNotificationId', () => {
  const kinds: AlarmKind[] = ['arrival', 'gpsLoss', 'lowBattery'];

  test.each(kinds)('round-trips alarmNotificationId for kind %s', (kind) => {
    expect(parseAlarmNotificationId(alarmNotificationId(kind, 42))).toEqual({ kind, journeyId: 42 });
  });

  test.each([
    undefined,
    '',
    'arrival-',
    'arrival-abc',
    'arrival-1.5',
    'arrival--3',
    'arrival-0x10',
    'gps-loss',
    'low-battery-',
    'foo-12',
    'expo-location-foreground-service',
    'arrival-12-extra',
    ' arrival-12',
  ])('returns null for non-alarm id %p', (id) => {
    expect(parseAlarmNotificationId(id)).toBeNull();
  });
});

test('cancelAllAlertsForJourney cancels the arrival, GPS-loss and low-battery ids for the journey', async () => {
  await cancelAllAlertsForJourney(9);
  expect(notifee.cancelAllNotifications).toHaveBeenCalledTimes(1);
  const ids = (notifee.cancelAllNotifications as jest.Mock).mock.calls[0][0] as string[];
  expect([...ids].sort()).toEqual(['arrival-9', 'gps-loss-9', 'low-battery-9']);
});
