import { clamp01, interpolatePollFreqPerMin, freqPerMinToIntervalMs } from './pollFrequency';

test('clamp01 bounds values to [0, 1]', () => {
  expect(clamp01(-5)).toBe(0);
  expect(clamp01(0.5)).toBe(0.5);
  expect(clamp01(5)).toBe(1);
  expect(clamp01(NaN)).toBe(0);
});

test('at the initial distance, frequency is the minimum', () => {
  expect(interpolatePollFreqPerMin(10_000, 10_000, 5, 20)).toBe(5);
});

test('at the destination, frequency is the maximum', () => {
  expect(interpolatePollFreqPerMin(0, 10_000, 5, 20)).toBe(20);
});

test('halfway there, frequency is halfway between min and max', () => {
  expect(interpolatePollFreqPerMin(5_000, 10_000, 5, 20)).toBeCloseTo(12.5, 5);
});

test('moving away from the destination (remaining > initial) does not exceed the minimum', () => {
  expect(interpolatePollFreqPerMin(15_000, 10_000, 5, 20)).toBe(5);
});

test('a zero initial distance (destination at start) returns the maximum, no division by zero', () => {
  expect(interpolatePollFreqPerMin(0, 0, 5, 20)).toBe(20);
  expect(Number.isFinite(interpolatePollFreqPerMin(100, 0, 5, 20))).toBe(true);
});

test('freqPerMinToIntervalMs converts per-minute frequency to a millisecond interval', () => {
  expect(freqPerMinToIntervalMs(60)).toBe(1_000);
  expect(freqPerMinToIntervalMs(1)).toBe(60_000);
});

test('freqPerMinToIntervalMs rejects a non-positive frequency', () => {
  expect(() => freqPerMinToIntervalMs(0)).toThrow();
});
