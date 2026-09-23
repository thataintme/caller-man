import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';

export const ALARM_CHANNEL_ID = 'caller-man-alarm';

export async function ensureAlarmChannel(): Promise<void> {
  await notifee.createChannel({
    id: ALARM_CHANNEL_ID,
    name: 'Journey alarm',
    importance: AndroidImportance.HIGH,
    bypassDnd: true,
    visibility: AndroidVisibility.PUBLIC,
    sound: 'default',
  });
}
