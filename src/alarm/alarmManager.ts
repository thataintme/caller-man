import notifee, { AndroidCategory, AndroidImportance } from '@notifee/react-native';
import { Journey } from '../types/journey';
import { ALARM_CHANNEL_ID, ensureAlarmChannel } from './alarmChannel';

/**
 * Shared Android presentation for every arrival/loss/battery alert: a loud,
 * looping, full-screen ALARM-category notification with Snooze/Dismiss
 * actions. Spec §8.4/§8.5 require GPS-loss and low-battery alerts to reuse
 * the arrival alarm's presentation, differing only in messaging.
 */
function alarmAndroidOptions() {
  return {
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
  };
}

export async function triggerAlarm(journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  await notifee.displayNotification({
    id: `arrival-${journey.id}`,
    title: "You've arrived",
    body: `You're within ${journey.radiusM}m of ${journey.name}`,
    android: alarmAndroidOptions(),
  });
}

export async function triggerGpsLossAlert(journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  await notifee.displayNotification({
    id: `gps-loss-${journey.id}`,
    title: 'Lost GPS signal',
    body: `Caller Man hasn't gotten a location fix for ${journey.name} in a while.`,
    android: alarmAndroidOptions(),
  });
}

export async function triggerLowBatteryAlert(journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  await notifee.displayNotification({
    id: `low-battery-${journey.id}`,
    title: 'Battery running low',
    body: `Battery has reached the cutoff you set for ${journey.name}.`,
    android: alarmAndroidOptions(),
  });
}
