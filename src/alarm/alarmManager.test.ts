import notifee from '@notifee/react-native';
import { triggerAlarm, triggerGpsLossAlert, triggerLowBatteryAlert } from './alarmManager';
import { Journey } from '../types/journey';

jest.mock('@notifee/react-native', () => ({
  createChannel: jest.fn().mockResolvedValue('caller-man-alarm'),
  displayNotification: jest.fn().mockResolvedValue('notif-id'),
  AndroidImportance: { HIGH: 4 },
  AndroidVisibility: { PUBLIC: 1 },
  AndroidCategory: { ALARM: 'alarm' },
}));

const journey: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: null, status: 'active',
  createdAt: 0, completedAt: null,
};

beforeEach(() => jest.clearAllMocks());

test('triggerAlarm displays a full-screen, DND-bypassing ALARM-category notification', async () => {
  await triggerAlarm(journey);
  expect(notifee.createChannel).toHaveBeenCalledWith(expect.objectContaining({ bypassDnd: true }));
  expect(notifee.displayNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      android: expect.objectContaining({
        category: 'alarm',
        fullScreenAction: { id: 'default' },
        loopSound: true,
      }),
    })
  );
});

test('triggerGpsLossAlert displays a full-screen alert with GPS-loss messaging', async () => {
  await triggerGpsLossAlert(journey);
  expect(notifee.displayNotification).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Lost GPS signal' })
  );
});

test('triggerLowBatteryAlert displays a full-screen alert with low-battery messaging', async () => {
  await triggerLowBatteryAlert(journey);
  expect(notifee.displayNotification).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Battery running low' })
  );
});
