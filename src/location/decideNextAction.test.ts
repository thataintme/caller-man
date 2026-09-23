import { decideNextAction } from './decideNextAction';
import { haversineDistanceM } from '../geo/haversine';
import { Journey } from '../types/journey';

const baseJourney: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: null, status: 'active',
  createdAt: 0, completedAt: null,
};

test('a fix inside the radius triggers the alarm', () => {
  const action = decideNextAction(baseJourney, { lat: 0.0001, lng: 0, speedMps: 1, accuracyM: 5, recordedAt: 1000 }, []);
  expect(action).toEqual({ type: 'alarm' });
});

test('a fix at the initial distance continues at the minimum frequency interval', () => {
  // ~10km north of the destination (>= initialDistanceM), matching initialDistanceM
  const action = decideNextAction(
    baseJourney,
    { lat: 0.09, lng: 0, speedMps: 0, accuracyM: 5, recordedAt: 1000 },
    []
  );
  expect(action.type).toBe('continue');
  if (action.type === 'continue') {
    expect(action.nextIntervalMs).toBe(12_000); // 60000 / 5/min
  }
});

test('a fix close to the destination continues at close to the maximum frequency interval', () => {
  const action = decideNextAction(
    baseJourney,
    { lat: 0.003, lng: 0, speedMps: 5, accuracyM: 5, recordedAt: 1000 },
    []
  );
  expect(action.type).toBe('continue');
  if (action.type === 'continue') {
    expect(action.nextIntervalMs).toBeLessThan(12_000);
    expect(action.nextIntervalMs).toBeGreaterThanOrEqual(3_000); // 60000 / 20/min
  }
});

test('the radius boundary is inclusive: exactly at radiusM triggers the alarm, one meter further continues', () => {
  const fix = { lat: 0.001, lng: 0, speedMps: 0, accuracyM: 5, recordedAt: 1000 };
  const distanceM = haversineDistanceM(
    { lat: fix.lat, lng: fix.lng },
    { lat: baseJourney.destinationLat, lng: baseJourney.destinationLng }
  );

  const journeyAtBoundary: Journey = { ...baseJourney, radiusM: distanceM };
  expect(decideNextAction(journeyAtBoundary, fix, [])).toEqual({ type: 'alarm' });

  const journeyJustOutside: Journey = { ...baseJourney, radiusM: distanceM - 1 };
  expect(decideNextAction(journeyJustOutside, fix, []).type).toBe('continue');
});

test('includes a null ETA when there is not yet enough estimation data', () => {
  const action = decideNextAction(
    baseJourney,
    { lat: 0.01, lng: 0, speedMps: null, accuracyM: 5, recordedAt: 1000 },
    []
  );
  expect(action.type).toBe('continue');
  if (action.type === 'continue') {
    expect(action.avgSpeedMps).toBeNull();
    expect(action.etaSeconds).toBeNull();
  }
});
