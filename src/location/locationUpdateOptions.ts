import * as Location from 'expo-location';

/**
 * The single builder for expo-location's background-update options, shared
 * by locationService.startTracking (initial registration) and the background
 * task's reschedules, so the foreground-service notification is identical in
 * both. Spec §5.6: it mirrors the destination and the remaining distance
 * (metric, §10). The text only refreshes when updates are (re)started — the
 * background task never restarts updates just to refresh it.
 */
export function trackingNotificationBody(destinationName: string, remainingDistanceM: number): string {
  return `${(remainingDistanceM / 1000).toFixed(1)} km remaining to ${destinationName}`;
}

export function locationUpdateOptions(
  destinationName: string,
  timeIntervalMs: number,
  remainingDistanceM: number
): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: timeIntervalMs,
    foregroundService: {
      notificationTitle: 'Caller Man — tracking active',
      notificationBody: trackingNotificationBody(destinationName, remainingDistanceM),
    },
    pausesUpdatesAutomatically: false,
  };
}
