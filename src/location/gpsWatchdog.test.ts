import { evaluateStaleFix } from './gpsWatchdog';
import { Journey } from '../types/journey';

const baseJourney: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: 100_000, status: 'active',
  createdAt: 0, completedAt: null,
};

test('no fix yet, within threshold of createdAt, is not stale', () => {
  // min freq 5/min -> 12s interval; +2min grace = 132s threshold from createdAt (0)
  expect(evaluateStaleFix({ ...baseJourney, lastFixAt: null }, 100_000)).toBe(false);
});

test('no fix yet, past threshold since createdAt, is stale', () => {
  expect(evaluateStaleFix({ ...baseJourney, lastFixAt: null }, 132_000 + 1)).toBe(true);
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
