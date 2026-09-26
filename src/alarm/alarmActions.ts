import notifee from '@notifee/react-native';
import { getDb } from '../db/expoSqliteClient';
import { getJourneyById, finishJourney } from '../db/journeysRepo';
import { pruneFixesForJourney } from '../db/locationLogRepo';
import { stopTracking } from '../location/locationService';
import { removeAreaCacheForJourney } from '../location/offlineMapCache';
import { Journey } from '../types/journey';
import { AlarmKind, alarmNotificationId, cancelAllAlertsForJourney, scheduleSnoozedAlert } from './alarmManager';

/**
 * Snooze/Dismiss for an alarm notification, shared by the Alarm-fired screen
 * and notifee's foreground/background event handlers. Self-contained (opens
 * the db and loads the journey itself) so it also runs in headless JS when
 * the user taps an action on the notification while the app is killed.
 */

/**
 * Loads the journey and returns it only if it's still active. Otherwise the
 * notification is stale (the journey was finished/cancelled elsewhere): every
 * alert for that journey is silenced and null is returned, so callers just
 * stop without error.
 */
async function loadActiveJourneyOrSilence(journeyId: number): Promise<Journey | null> {
  const db = await getDb();
  const journey = await getJourneyById(db, journeyId);
  if (!journey || journey.status !== 'active') {
    await cancelAllAlertsForJourney(journeyId);
    return null;
  }
  return journey;
}

export async function snoozeAlarm(journeyId: number, kind: AlarmKind): Promise<void> {
  const journey = await loadActiveJourneyOrSilence(journeyId);
  if (!journey) return;

  // cancelNotification removes both the displayed notification and any
  // pending trigger registered under this id; it must run before scheduling,
  // since the snoozed re-alert reuses the same id.
  await notifee.cancelNotification(alarmNotificationId(kind, journeyId));
  await scheduleSnoozedAlert(journey, kind, Date.now() + journey.snoozeMinutes * 60_000);
}

export async function dismissAlarm(journeyId: number, kind: AlarmKind): Promise<void> {
  const journey = await loadActiveJourneyOrSilence(journeyId);
  if (!journey) return;

  if (kind === 'gpsLoss') {
    // gps-loss-<id> is also the GPS-loss dead-man deadline (see
    // location/gpsWatchdog). A fresh fix may already have re-armed it while
    // this alert was showing, so only clear the displayed alert — cancelling
    // the id outright would silently stop GPS-loss monitoring until the next
    // fix.
    await notifee.cancelDisplayedNotification(alarmNotificationId(kind, journeyId));
    return;
  }

  // For arrival this id is cancelled again by cancelAllAlertsForJourney below;
  // the double cancel is intentional and harmless (keeps one uniform
  // "silence this alarm first" step for every kind).
  await notifee.cancelNotification(alarmNotificationId(kind, journeyId));
  if (kind !== 'arrival') return;

  // Arrival ends the journey: also silence the journey's other alert ids, so
  // a pending GPS-loss/low-battery snooze can't ring after it's over.
  await cancelAllAlertsForJourney(journeyId);
  const db = await getDb();
  await finishJourney(db, journeyId, 'completed');
  await pruneFixesForJourney(db, journeyId);
  await stopTracking();

  // R30.1/R30.2: evict the offline area cache now the journey has arrived.
  // Best-effort — a failure here must never surface as a dismiss error.
  try {
    await removeAreaCacheForJourney(journeyId);
  } catch {
    // best effort
  }
}

export type RouteAfterAlarm = { name: 'Journeys' } | { name: 'CurrentJourney'; params: { journeyId: number } };

/** Where the app goes once an alarm has been snoozed or dismissed. */
export function nextRouteAfterAlarm(kind: AlarmKind, journeyId: number): RouteAfterAlarm {
  if (kind === 'arrival') return { name: 'Journeys' };
  return { name: 'CurrentJourney', params: { journeyId } };
}
