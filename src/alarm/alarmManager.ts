import notifee, { AndroidCategory, AndroidImportance } from '@notifee/react-native';
import { Journey } from '../types/journey';
import { ALARM_CHANNEL_ID, ensureAlarmChannel } from './alarmChannel';

export async function triggerAlarm(journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  await notifee.displayNotification({
    title: "You've arrived",
    body: `You're within ${journey.radiusM}m of ${journey.name}`,
    android: {
      channelId: ALARM_CHANNEL_ID,
      category: AndroidCategory.ALARM,
      importance: AndroidImportance.HIGH,
      fullScreenAction: { id: 'default' },
      loopSound: true,
      pressAction: { id: 'default' },
      actions: [
        { title: 'Snooze', pressAction: { id: 'snooze' } },
        { title: 'Dismiss', pressAction: { id: 'dismiss' } },
      ],
    },
  });
}

export async function triggerGpsLossAlert(journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  await notifee.displayNotification({
    title: 'Lost GPS signal',
    body: `Caller Man hasn't gotten a location fix for ${journey.name} in a while.`,
    android: {
      channelId: ALARM_CHANNEL_ID,
      category: AndroidCategory.ALARM,
      importance: AndroidImportance.HIGH,
      fullScreenAction: { id: 'default' },
    },
  });
}

export async function triggerLowBatteryAlert(journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  await notifee.displayNotification({
    title: 'Battery running low',
    body: `Battery has reached the cutoff you set for ${journey.name}.`,
    android: {
      channelId: ALARM_CHANNEL_ID,
      category: AndroidCategory.ALARM,
      importance: AndroidImportance.HIGH,
      fullScreenAction: { id: 'default' },
    },
  });
}
