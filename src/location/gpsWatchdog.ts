import { freqPerMinToIntervalMs } from '../geo/pollFrequency';
import { Journey } from '../types/journey';
import { getDb } from '../db/expoSqliteClient';
import { getActiveJourney } from '../db/journeysRepo';

const CHECK_INTERVAL_MS = 30_000;
let watchdogHandle: ReturnType<typeof setInterval> | null = null;

export function evaluateStaleFix(journey: Journey, nowMs: number): boolean {
  if (journey.arrivedAt !== null) return false;
  const referenceAt = journey.lastFixAt ?? journey.createdAt;
  const currentIntervalMs = freqPerMinToIntervalMs(journey.minPollFreqPerMin);
  const graceMs = journey.gpsLossGraceMinutes * 60_000;
  return nowMs - referenceAt > currentIntervalMs + graceMs;
}

export function startGpsWatchdog(onStale: (journey: Journey) => void): void {
  if (watchdogHandle) return;
  watchdogHandle = setInterval(async () => {
    try {
      const db = await getDb();
      const journey = await getActiveJourney(db);
      if (journey && evaluateStaleFix(journey, Date.now())) {
        onStale(journey);
      }
    } catch (error) {
      console.warn('GPS watchdog check failed', error);
      return;
    }
  }, CHECK_INTERVAL_MS);
}

export function stopGpsWatchdog(): void {
  if (watchdogHandle) {
    clearInterval(watchdogHandle);
    watchdogHandle = null;
  }
}
