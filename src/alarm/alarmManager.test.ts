import notifee from '@notifee/react-native';
import { triggerAlarm, triggerGpsLossAlert, triggerLowBatteryAlert, scheduleSnoozedAlert } from './alarmManager';
import { Journey } from '../types/journey';

jest.mock('@notifee/react-native', () => ({
  createChannel: jest.fn().mockResolvedValue('caller-man-alarm'),
  displayNotification: jest.fn().mockResolvedValue('notif-id'),
  createTriggerNotification: jest.fn().mockResolvedValue('notif-id'),
  AndroidImportance: { HIGH: 4 },
  AndroidVisibility: { PUBLIC: 1 },
  AndroidCategory: { ALARM: 'alarm' },
  TriggerType: { TIMESTAMP: 0 },
  AlarmType: { SET_ALARM_CLOCK: 4 },
}));

const journey: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: null, status: 'active',
  createdAt: 0, completedAt: null, arrivedAt: null,
};

beforeEach(() => jest.clearAllMocks());

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
    expect.objectContaining({ type: 0, timestamp: atMs })
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
    expect.objectContaining({ type: 0, timestamp: atMs })
  );
});
