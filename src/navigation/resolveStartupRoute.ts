import notifee from '@notifee/react-native';
import * as Location from 'expo-location';
import { getDb } from '../db/expoSqliteClient';
import { runMigrations } from '../db/migrations';
import { Db } from '../db/types';
import { getActiveJourney, getJourneyById } from '../db/journeysRepo';
import { resumeMonitorsIfActive } from '../location/locationService';
import { AlarmKind, parseAlarmNotificationId } from '../alarm/alarmManager';
import { resolveInitialRoute } from './resolveInitialRoute';

export type StartupRoute =
  | { name: 'Welcome' }
  | { name: 'Journeys' }
  | { name: 'CurrentJourney'; params: { journeyId: number } }
  | { name: 'Alarm'; params: { journeyId: number; kind: AlarmKind } };

/**
 * If the app was launched by an alarm notification (tap or full-screen
 * intent) for a journey that is still active, the Alarm to open. A failed
 * lookup of the initial notification only loses this shortcut, so it's
 * logged and treated as "none" rather than blocking startup.
 */
async function alarmFromInitialNotification(db: Db): Promise<StartupRoute | null> {
  let notificationId: string | undefined;
  try {
    const initial = await notifee.getInitialNotification();
    notificationId = initial?.notification.id;
  } catch (error) {
    console.warn('Could not read the notification that launched the app', error);
    return null;
  }

  const target = parseAlarmNotificationId(notificationId);
  if (!target) return null;

  const journey = await getJourneyById(db, target.journeyId);
  if (!journey || journey.status !== 'active') return null;
  return { name: 'Alarm', params: target };
}

/**
 * Spec §5.1's "first boot only" Welcome screen is decided by permission
 * state, not a stored flag: on first boot nothing is granted so Welcome
 * shows; it only reappears if GPS/background location is later revoked,
 * which the spec treats as a hard requirement anyway. Only checks — never
 * prompts (the Welcome screen does the asking).
 */
async function hasRequiredLocationPermissions(): Promise<boolean> {
  const [fg, bg] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
  ]);
  return fg.granted && bg.granted;
}

/**
 * Cold-start routing. Order: migrate the db, re-arm the GPS-loss/low-battery
 * monitors for an active journey (they only live in this JS context, so a
 * process restart loses them; resumeMonitorsIfActive is idempotent), then
 * decide: a launching alarm notification > Welcome (permissions missing) >
 * resolveInitialRoute(active journey).
 */
export async function resolveStartupRoute(): Promise<StartupRoute> {
  const db = await getDb();
  await runMigrations(db);
  await resumeMonitorsIfActive();

  const alarm = await alarmFromInitialNotification(db);
  if (alarm) return alarm;

  if (!(await hasRequiredLocationPermissions())) {
    return { name: 'Welcome' };
  }

  return resolveInitialRoute(await getActiveJourney(db));
}
