import { haversineDistanceM } from '../geo/haversine';
import { interpolatePollFreqPerMin, freqPerMinToIntervalMs } from '../geo/pollFrequency';
import { averageSpeedMps, estimateEta, Fix } from '../geo/estimation';
import { Journey } from '../types/journey';

export interface FixInput {
  lat: number;
  lng: number;
  speedMps: number | null;
  accuracyM: number | null;
  recordedAt: number;
}

export type NextAction =
  | { type: 'alarm' }
  | {
      type: 'continue';
      nextIntervalMs: number;
      remainingDistanceM: number;
      avgSpeedMps: number | null;
      etaSeconds: number | null;
      alarmEtaSeconds: number | null;
    };

export function decideNextAction(
  journey: Journey,
  fix: FixInput,
  recentFixesForEstimation: Fix[]
): NextAction {
  const destination = { lat: journey.destinationLat, lng: journey.destinationLng };
  const remainingDistanceM = haversineDistanceM({ lat: fix.lat, lng: fix.lng }, destination);

  if (remainingDistanceM <= journey.radiusM) {
    return { type: 'alarm' };
  }

  const nextFreqPerMin = interpolatePollFreqPerMin(
    remainingDistanceM,
    journey.initialDistanceM,
    journey.minPollFreqPerMin,
    journey.maxPollFreqPerMin
  );
  const nextIntervalMs = freqPerMinToIntervalMs(nextFreqPerMin);

  const avgSpeedMps = averageSpeedMps(recentFixesForEstimation, fix.recordedAt);
  const eta = estimateEta(remainingDistanceM, journey.radiusM, avgSpeedMps);

  return {
    type: 'continue',
    nextIntervalMs,
    remainingDistanceM,
    avgSpeedMps,
    etaSeconds: eta?.etaSeconds ?? null,
    alarmEtaSeconds: eta?.alarmEtaSeconds ?? null,
  };
}
