import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { Journey } from '../types/journey';
import { LOCATION_TASK_NAME } from './taskName';
import './backgroundTask'; // registers the task as a side effect
import { startGpsWatchdog, stopGpsWatchdog } from './gpsWatchdog';
import { triggerLowBatteryAlert, triggerGpsLossAlert } from '../alarm/alarmManager';
import { freqPerMinToIntervalMs } from '../geo/pollFrequency';

let batterySubscription: { remove: () => void } | null = null;

export async function requestPermissions(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted;
}

export async function startTracking(journey: Journey): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: freqPerMinToIntervalMs(journey.minPollFreqPerMin),
    foregroundService: {
      notificationTitle: 'Caller Man — tracking active',
      notificationBody: `Heading to ${journey.name}`,
    },
    pausesUpdatesAutomatically: false,
  });

  startGpsWatchdog((staleJourney) => {
    triggerGpsLossAlert(staleJourney).catch((err) => console.error('Failed to trigger GPS loss alert', err));
  });

  batterySubscription = Battery.addBatteryLevelListener(({ batteryLevel }) => {
    const pct = Math.round(batteryLevel * 100);
    if (pct <= journey.batteryCutoffPct) {
      triggerLowBatteryAlert(journey).catch((err) => console.error('Failed to trigger low battery alert', err));
    }
  });
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
