import { evaluateStaleFix } from './gpsWatchdog';
import { Journey } from '../types/journey';

const baseJourney: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: 100_000, status: 'active',
  createdAt: 0, completedAt: null,
};

test('no fix yet is not treated as stale (nothing to compare against)', () => {
  expect(evaluateStaleFix({ ...baseJourney, lastFixAt: null }, 200_000)).toBe(false);
});

test('a recent fix is not stale', () => {
  // min freq 5/min -> 12s interval; +2min grace = 132s threshold
  expect(evaluateStaleFix(baseJourney, 100_000 + 60_000)).toBe(false);
});

test('a fix older than interval + grace period is stale', () => {
  expect(evaluateStaleFix(baseJourney, 100_000 + 132_000 + 1)).toBe(true);
});

test('exactly at the threshold is not yet stale', () => {
  expect(evaluateStaleFix(baseJourney, 100_000 + 132_000)).toBe(false);
});
