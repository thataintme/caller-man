import notifee, { AlarmType, AndroidCategory, AndroidImportance, TriggerType } from '@notifee/react-native';
import { Journey } from '../types/journey';
import { ALARM_CHANNEL_ID, ensureAlarmChannel } from './alarmChannel';

export type AlarmKind = 'arrival' | 'gpsLoss' | 'lowBattery';

/**
 * Shared Android presentation for every arrival/loss/battery alert: a loud,
 * looping, full-screen ALARM-category notification with Snooze/Dismiss
 * actions. Spec §8 items 4/5 require GPS-loss and low-battery alerts to reuse
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

/**
 * The stable notifee notification id for a given journey's alert of a given
 * kind. Used both to display/schedule the alert and to silence it (via
 * notifee.cancelNotification) from the Alarm-fired screen — must stay in
 * sync between trigger*, scheduleSnoozedAlert, and any cancellation.
 */
export function alarmNotificationId(kind: AlarmKind, journeyId: number): string {
  switch (kind) {
    case 'arrival':
      return `arrival-${journeyId}`;
    case 'gpsLoss':
      return `gps-loss-${journeyId}`;
    case 'lowBattery':
      return `low-battery-${journeyId}`;
  }
}

function alarmContent(kind: AlarmKind, journey: Journey): { title: string; body: string } {
  switch (kind) {
    case 'arrival':
      return { title: "You've arrived", body: `You're within ${journey.radiusM}m of ${journey.name}` };
    case 'gpsLoss':
      return {
        title: 'Lost GPS signal',
        body: `Caller Man hasn't gotten a location fix for ${journey.name} in a while.`,
      };
    case 'lowBattery':
      return { title: 'Battery running low', body: `Battery has reached the cutoff you set for ${journey.name}.` };
  }
}

async function displayAlarm(kind: AlarmKind, journey: Journey): Promise<void> {
  await ensureAlarmChannel();
  const { title, body } = alarmContent(kind, journey);
  await notifee.displayNotification({
    id: alarmNotificationId(kind, journey.id),
    title,
    body,
    android: alarmAndroidOptions(),
  });
}

export async function triggerAlarm(journey: Journey): Promise<void> {
  await displayAlarm('arrival', journey);
}

export async function triggerGpsLossAlert(journey: Journey): Promise<void> {
  await displayAlarm('gpsLoss', journey);
}

export async function triggerLowBatteryAlert(journey: Journey): Promise<void> {
  await displayAlarm('lowBattery', journey);
}

/**
 * Schedules a snoozed re-alert at `atMs` using notifee's TimestampTrigger,
 * so it fires even if the app is backgrounded or killed in the meantime
 * (unlike a JS setTimeout, which is lost with the process). Reuses the same
 * stable id and presentation as the original alert of this kind, so
 * dismissing/snoozing it again from the Alarm screen works identically.
 *
 * Scheduled with AlarmType.SET_ALARM_CLOCK so Android treats it like a real
 * alarm clock (exempt from Doze/App Standby deferral), matching the "bypass
 * DND / display over other apps" alarm-clock behavior spec §9 calls for.
 */
export async function scheduleSnoozedAlert(journey: Journey, kind: AlarmKind, atMs: number): Promise<void> {
  await ensureAlarmChannel();
  const { title, body } = alarmContent(kind, journey);
  await notifee.createTriggerNotification(
    {
      id: alarmNotificationId(kind, journey.id),
      title,
      body,
      android: alarmAndroidOptions(),
    },
    {
      type: TriggerType.TIMESTAMP,
      timestamp: atMs,
      alarmManager: { type: AlarmType.SET_ALARM_CLOCK },
    }
  );
}
