import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { Journey } from '../types/journey';
import { LOCATION_TASK_NAME } from './taskName';
import './backgroundTask'; // registers the task as a side effect
import { setLastAppliedIntervalMs } from './backgroundTask';
import { gpsLossDeadlineMs } from './gpsWatchdog';
import { locationUpdateOptions } from './locationUpdateOptions';
import { armGpsLossDeadline, triggerLowBatteryAlert } from '../alarm/alarmManager';
import { freqPerMinToIntervalMs } from '../geo/pollFrequency';
import { getDb } from '../db/expoSqliteClient';
import { getActiveJourney } from '../db/journeysRepo';

let batterySubscription: { remove: () => void } | null = null;

/**
 * Starts the low-battery listener for a journey. Shared by startTracking
 * (fresh start) and resumeMonitorsIfActive (after a process restart), so both
 * get the same one-shot low-battery behavior and neither leaks a stale
 * subscription. (GPS-loss monitoring isn't a listener: it's a notifee trigger
 * armed via armGpsLossDeadline — see gpsWatchdog.)
 */
function startBatteryMonitor(journey: Journey): void {
  batterySubscription?.remove();
  let lowBatteryAlerted = false;
  batterySubscription = Battery.addBatteryLevelListener(({ batteryLevel }) => {
    if (batteryLevel < 0) return; // unknown level, nothing to act on
    if (lowBatteryAlerted) return;
    const pct = Math.round(batteryLevel * 100);
    if (pct <= journey.batteryCutoffPct) {
      lowBatteryAlerted = true;
      triggerLowBatteryAlert(journey).catch((err) => console.error('Failed to trigger low battery alert', err));
    }
  });
}

export async function requestPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted;
}

export async function startTracking(journey: Journey): Promise<void> {
  const initialIntervalMs = freqPerMinToIntervalMs(journey.minPollFreqPerMin);
  await Location.startLocationUpdatesAsync(
    LOCATION_TASK_NAME,
    locationUpdateOptions(journey.name, initialIntervalMs, journey.initialDistanceM)
  );
  setLastAppliedIntervalMs(initialIntervalMs);
  // No fix yet: the deadline counts from the journey's creation.
  await armGpsLossDeadline(journey, gpsLossDeadlineMs(journey, initialIntervalMs));
  startBatteryMonitor(journey);
}

/**
 * Re-arms the monitors for whatever journey is currently active, without
 * touching location updates (those are the OS's job to keep running /
 * redeliver via the background task once JS restarts). Called once at app
 * startup, since the battery subscription only lives in this JS context and
 * is lost across a process restart.
 *
 * The GPS-loss deadline trigger itself survives a restart (notifee persists
 * it), but is re-armed here from the latest fix, using the min-frequency
 * interval (the longest one; the applied interval isn't persisted). Only a
 * deadline still in the future is re-armed: a past one has either already
 * fired (and been handled — re-arming would ring again on every app open) or
 * been snoozed, and that pending snooze must not be overridden.
 */
export async function resumeMonitorsIfActive(): Promise<void> {
  const db = await getDb();
  const journey = await getActiveJourney(db);
  if (!journey || journey.arrivedAt !== null) return;
  const deadlineMs = gpsLossDeadlineMs(journey, freqPerMinToIntervalMs(journey.minPollFreqPerMin));
  if (deadlineMs > Date.now()) {
    await armGpsLossDeadline(journey, deadlineMs);
  }
  startBatteryMonitor(journey);
}

export async function stopTracking(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
  batterySubscription?.remove();
  batterySubscription = null;
}
