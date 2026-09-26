import notifee, {
  AlarmType,
  AndroidCategory,
  AndroidImportance,
  AndroidNotificationSetting,
  TriggerType,
  TimestampTriggerAlarmManager,
} from '@notifee/react-native';
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

const ALARM_ID_PATTERN = /^(arrival|gps-loss|low-battery)-([1-9]\d*)$/;

const KIND_BY_ID_PREFIX: Record<string, AlarmKind> = {
  arrival: 'arrival',
  'gps-loss': 'gpsLoss',
  'low-battery': 'lowBattery',
};

/**
 * Inverse of alarmNotificationId. Returns null for any id that isn't one of
 * ours (e.g. expo-location's foreground-service notification), so event
 * handlers can safely ignore unrelated notifications.
 */
export function parseAlarmNotificationId(
  id: string | undefined | null
): { kind: AlarmKind; journeyId: number } | null {
  if (!id) return null;
  const match = ALARM_ID_PATTERN.exec(id);
  if (!match) return null;
  const journeyId = Number(match[2]);
  if (!Number.isSafeInteger(journeyId)) return null;
  return { kind: KIND_BY_ID_PREFIX[match[1]], journeyId };
}

const ALL_ALARM_KINDS: AlarmKind[] = ['arrival', 'gpsLoss', 'lowBattery'];

/**
 * Cancels every alert id for a journey — displayed or pending snoozed
 * trigger (on Android, cancelAllNotifications(ids) cancels both types, same
 * as cancelNotification does for a single id) — so nothing can ring after
 * the journey has ended.
 */
export async function cancelAllAlertsForJourney(journeyId: number): Promise<void> {
  await notifee.cancelAllNotifications(ALL_ALARM_KINDS.map((kind) => alarmNotificationId(kind, journeyId)));
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
 * Resolves the alarmManager config for a scheduled trigger. Prefers
 * AlarmType.SET_ALARM_CLOCK (exempt from Doze/App Standby deferral, matching
 * the "bypass DND / display over other apps" alarm-clock behavior spec §9
 * calls for), but that type is an exact alarm: on API 31+ notifee silently
 * drops the trigger (logs and returns without throwing) when the app lacks
 * the SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM permission, which is revoked by
 * default for new installs on Android 14+. So this checks
 * notifee.getNotificationSettings().android.alarm first and falls back to
 * AlarmType.SET_AND_ALLOW_WHILE_IDLE (not exact, never blocked by the
 * exact-alarm permission) whenever that permission isn't ENABLED — including
 * when the settings check itself throws, since a snooze must never be lost
 * because of a failed permission probe.
 */
async function resolveAlarmManagerConfig(): Promise<TimestampTriggerAlarmManager> {
  try {
    const settings = await notifee.getNotificationSettings();
    if (settings.android.alarm === AndroidNotificationSetting.ENABLED) {
      return { type: AlarmType.SET_ALARM_CLOCK };
    }
  } catch {
    // Fall through to the non-exact fallback below — never fail the snooze
    // because the permission check itself failed.
  }
  return { type: AlarmType.SET_AND_ALLOW_WHILE_IDLE };
}

/**
 * Schedules a snoozed re-alert at `atMs` using notifee's TimestampTrigger,
 * so it fires even if the app is backgrounded or killed in the meantime
 * (unlike a JS setTimeout, which is lost with the process). Reuses the same
 * stable id and presentation as the original alert of this kind, so
 * dismissing/snoozing it again from the Alarm screen works identically.
 */
export async function scheduleSnoozedAlert(journey: Journey, kind: AlarmKind, atMs: number): Promise<void> {
  await ensureAlarmChannel();
  const { title, body } = alarmContent(kind, journey);
  const alarmManagerConfig = await resolveAlarmManagerConfig();
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
      alarmManager: alarmManagerConfig,
    }
  );
}
