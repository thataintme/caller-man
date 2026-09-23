import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { Journey } from '../types/journey';
import { LOCATION_TASK_NAME } from './taskName';
import './backgroundTask'; // registers the task as a side effect
import { setLastAppliedIntervalMs } from './backgroundTask';
import { startGpsWatchdog, stopGpsWatchdog } from './gpsWatchdog';
import { triggerLowBatteryAlert, triggerGpsLossAlert } from '../alarm/alarmManager';
import { freqPerMinToIntervalMs } from '../geo/pollFrequency';
import { getDb } from '../db/expoSqliteClient';
import { getActiveJourney } from '../db/journeysRepo';

let batterySubscription: { remove: () => void } | null = null;

/**
 * Starts the GPS-loss watchdog and the low-battery listener for a journey.
 * Shared by startTracking (fresh start) and resumeMonitorsIfActive (after a
 * process restart), so both get the same one-shot low-battery behavior and
 * neither leaks a stale subscription.
 */
function startMonitors(journey: Journey): void {
  startGpsWatchdog((staleJourney) => {
    triggerGpsLossAlert(staleJourney).catch((err) => console.error('Failed to trigger GPS loss alert', err));
  });

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
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: initialIntervalMs,
    foregroundService: {
      notificationTitle: 'Caller Man — tracking active',
      notificationBody: `Heading to ${journey.name}`,
    },
    pausesUpdatesAutomatically: false,
  });
  setLastAppliedIntervalMs(initialIntervalMs);

  startMonitors(journey);
}

/**
 * Re-arms the GPS watchdog and low-battery listener for whatever journey is
 * currently active, without touching location updates (those are the OS's
 * job to keep running / redeliver via the background task once JS restarts).
 * Meant to be called once at app startup (Task 27b), since the watchdog
 * timer and battery subscription only live in this JS context and are lost
 * across a process restart.
 */
export async function resumeMonitorsIfActive(): Promise<void> {
  const db = await getDb();
  const journey = await getActiveJourney(db);
  if (!journey || journey.arrivedAt !== null) return;
  startMonitors(journey);
}

export async function stopTracking(): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
  stopGpsWatchdog();
  batterySubscription?.remove();
  batterySubscription = null;
}
