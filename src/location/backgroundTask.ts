import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { LOCATION_TASK_NAME } from './taskName';
import { getDb } from '../db/expoSqliteClient';
import { getActiveJourney, updateLastFixAt, markArrived } from '../db/journeysRepo';
import { insertFix, getRecentFixes } from '../db/locationLogRepo';
import { decideNextAction } from './decideNextAction';
import { triggerAlarm, armGpsLossDeadline, cancelGpsLossAlert } from '../alarm/alarmManager';
import { gpsLossDeadlineMs } from './gpsWatchdog';
import { locationUpdateOptions } from './locationUpdateOptions';

// Only re-register location updates when the new poll interval differs from
// the one currently applied by at least this fraction, to avoid restarting
// the OS-level location subscription on every single fix.
const RESCHEDULE_THRESHOLD_RATIO = 0.1;

// Module-level so both the background task's own reschedules and
// locationService.startTracking's initial registration share one source of
// truth for "what interval is currently applied".
let lastAppliedIntervalMs: number | null = null;

export function setLastAppliedIntervalMs(ms: number): void {
  lastAppliedIntervalMs = ms;
}

async function stopLocationUpdatesIfStarted(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Location task error', error);
    return;
  }

  try {
    const { locations } = data as { locations: Location.LocationObject[] };
    const latest = locations[locations.length - 1];
    if (!latest) return;

    const db = await getDb();
    const journey = await getActiveJourney(db);
    if (!journey) {
      // The journey was cancelled/finished elsewhere; don't leave the
      // foreground service (and its notification) running for nothing.
      await stopLocationUpdatesIfStarted();
      return;
    }

    if (journey.arrivedAt !== null) {
      // Arrival was already recorded (e.g. a leftover fix arrived after we
      // already alarmed and tried to stop). Don't re-fire; just tear down.
      await stopLocationUpdatesIfStarted();
      return;
    }

    const fix = {
      lat: latest.coords.latitude,
      lng: latest.coords.longitude,
      speedMps: latest.coords.speed ?? null,
      accuracyM: latest.coords.accuracy ?? null,
      recordedAt: latest.timestamp,
    };
    await insertFix(db, journey.id, fix.lat, fix.lng, fix.speedMps, fix.accuracyM, fix.recordedAt);
    await updateLastFixAt(db, journey.id, fix.recordedAt);

    const recent = await getRecentFixes(db, journey.id, fix.recordedAt - 3 * 60 * 1000);
    const action = decideNextAction(journey, fix, recent);

    if (action.type === 'alarm') {
      // Fire the alarm before persisting arrival: if triggerAlarm throws
      // (e.g. a notification channel/permission failure), we must not mark
      // arrived, or the next fix would early-return above — silently and
      // permanently losing the alarm. triggerAlarm uses the stable
      // notification id `arrival-${journey.id}`, so a retry on the next fix
      // just updates the same notification rather than stacking duplicates.
      // (A failed attempt doesn't re-arm the GPS-loss deadline, so if every
      // retry fails, the previous fix's deadline still wakes the user.)
      await triggerAlarm(journey);
      // The journey has arrived: its GPS-loss deadline must not ring later.
      await cancelGpsLossAlert(journey.id);
      await markArrived(db, journey.id, fix.recordedAt);
      await stopLocationUpdatesIfStarted();
      return;
    }

    const shouldReschedule =
      lastAppliedIntervalMs === null ||
      Math.abs(action.nextIntervalMs - lastAppliedIntervalMs) / lastAppliedIntervalMs >= RESCHEDULE_THRESHOLD_RATIO;
    const intervalAfterThisFixMs = shouldReschedule ? action.nextIntervalMs : (lastAppliedIntervalMs as number);

    // GPS-loss dead-man's switch (spec §8.4, see gpsWatchdog): this fix
    // pushes the deadline out, replacing the pending GPS-loss trigger (or a
    // pending snooze of the GPS-loss alert — GPS is evidently back).
    await armGpsLossDeadline(
      journey,
      gpsLossDeadlineMs({ ...journey, lastFixAt: fix.recordedAt }, intervalAfterThisFixMs)
    );

    // Re-read the active journey right before rescheduling: the journey may
    // have been cancelled/finished, or arrived via another path, while the
    // awaits above were in flight. Only reschedule if it's still the same,
    // still-unarrived journey; otherwise undo the deadline just armed.
    const stillActive = await getActiveJourney(db);
    if (!stillActive || stillActive.id !== journey.id || stillActive.arrivedAt !== null) {
      await cancelGpsLossAlert(journey.id);
      await stopLocationUpdatesIfStarted();
      return;
    }

    if (shouldReschedule) {
      await Location.startLocationUpdatesAsync(
        LOCATION_TASK_NAME,
        locationUpdateOptions(journey.name, action.nextIntervalMs, action.remainingDistanceM)
      );
      lastAppliedIntervalMs = action.nextIntervalMs;
    }
  } catch (taskError) {
    console.error('Location task failed', taskError);
  }
});
