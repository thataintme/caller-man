import { haversineDistanceM } from './haversine';

export interface Fix {
  lat: number;
  lng: number;
  recordedAt: number;
}

const ESTIMATION_WINDOW_MS = 3 * 60 * 1000;

export function averageSpeedMps(recentFixes: Fix[], nowMs: number): number | null {
  const windowFixes = recentFixes
    .filter((f) => nowMs - f.recordedAt <= ESTIMATION_WINDOW_MS)
    .sort((a, b) => a.recordedAt - b.recordedAt);

  if (windowFixes.length < 2) {
    return null;
  }

  const first = windowFixes[0];
  const last = windowFixes[windowFixes.length - 1];
  const distanceM = haversineDistanceM(first, last);
  const elapsedS = (last.recordedAt - first.recordedAt) / 1000;
  if (elapsedS <= 0) {
    return null;
  }
  return distanceM / elapsedS;
}

export interface EtaEstimate {
  etaSeconds: number;
  alarmEtaSeconds: number;
}

export function estimateEta(
  remainingDistanceM: number,
  radiusM: number,
  avgSpeedMps: number | null
): EtaEstimate | null {
  if (avgSpeedMps === null || avgSpeedMps <= 0.1) {
    return null;
  }
  return {
    etaSeconds: remainingDistanceM / avgSpeedMps,
    alarmEtaSeconds: Math.max(0, remainingDistanceM - radiusM) / avgSpeedMps,
  };
}
