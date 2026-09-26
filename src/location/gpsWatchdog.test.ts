import * as gpsWatchdog from './gpsWatchdog';
import { gpsLossDeadlineMs } from './gpsWatchdog';
import { Journey } from '../types/journey';

const baseJourney: Journey = {
  id: 1, name: 'Station', destinationLat: 0, destinationLng: 0, radiusM: 200,
  maxPollFreqPerMin: 20, minPollFreqPerMin: 5, alarmTune: 'Radar Ping',
  batteryCutoffPct: 15, snoozeMinutes: 3, gpsLossGraceMinutes: 2,
  initialDistanceM: 10_000, lastFixAt: 100_000, status: 'active',
  createdAt: 0, completedAt: null, arrivedAt: null,
};

describe('gpsLossDeadlineMs (spec §8.4: current poll interval + grace period)', () => {
  test('is the last fix time + the current poll interval + the grace period', () => {
    // 100s last fix + 12s interval + 2min grace
    expect(gpsLossDeadlineMs(baseJourney, 12_000)).toBe(100_000 + 12_000 + 120_000);
  });

  test('uses the journey createdAt when there is no fix yet', () => {
    const noFix = { ...baseJourney, lastFixAt: null, createdAt: 50_000 };
    expect(gpsLossDeadlineMs(noFix, 12_000)).toBe(50_000 + 12_000 + 120_000);
  });

  test('uses the given (current) poll interval, not a fixed one', () => {
    expect(gpsLossDeadlineMs(baseJourney, 3_000)).toBe(100_000 + 3_000 + 120_000);
  });

  test('scales with the journey grace period', () => {
    expect(gpsLossDeadlineMs({ ...baseJourney, gpsLossGraceMinutes: 10 }, 12_000)).toBe(100_000 + 12_000 + 600_000);
  });
});

test('no JS-timer watchdog remains (it never ticks while the app is paused/locked)', () => {
  expect(Object.keys(gpsWatchdog).sort()).toEqual(['gpsLossDeadlineMs']);
});
