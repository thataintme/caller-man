import { Journey } from '../types/journey';

/**
 * GPS-loss watchdog (spec §8.4), as a dead-man's switch: instead of a JS
 * timer polling for a stale fix (RN pauses JS timers while the app is
 * backgrounded/locked, and a headless task process starts with them paused,
 * so such a timer never ticks in the very situation it exists for), the
 * GPS-loss alert is pre-scheduled as a notifee trigger at this deadline
 * (alarmManager.armGpsLossDeadline). Every fresh fix re-arms it further out,
 * replacing the pending trigger (same id); if fixes stop, it fires.
 *
 * Deadline = time of the last fix (or the journey's creation, before the
 * first fix) + the current poll interval + the journey's grace period.
 */
export function gpsLossDeadlineMs(
  journey: Pick<Journey, 'lastFixAt' | 'createdAt' | 'gpsLossGraceMinutes'>,
  currentIntervalMs: number
): number {
  const referenceAt = journey.lastFixAt ?? journey.createdAt;
  return referenceAt + currentIntervalMs + journey.gpsLossGraceMinutes * 60_000;
}
