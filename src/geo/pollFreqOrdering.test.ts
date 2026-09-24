import { reconcileMinMaxFreq } from './pollFreqOrdering';
import { POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN } from '../constants/limits';

test('leaves a valid min < max pair unchanged', () => {
  expect(reconcileMinMaxFreq('min', 5, 20)).toEqual({ minFreqPerMin: 5, maxFreqPerMin: 20 });
});

test('raising min above max pulls max up with it', () => {
  expect(reconcileMinMaxFreq('min', 25, 20)).toEqual({ minFreqPerMin: 25, maxFreqPerMin: 26 });
});

test('lowering max below min pulls min down with it', () => {
  expect(reconcileMinMaxFreq('max', 5, 3)).toEqual({ minFreqPerMin: 2, maxFreqPerMin: 3 });
});

// Was: expected { minFreqPerMin: 1, maxFreqPerMin: 0 } — that asserted the broken
// out-of-bounds/max<=min output. §5.3 requires max > min always; the fixed function
// now clamps to [POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN] first and, since the
// clamped max lands on the bottom limit, raises max to 2 and pins min to 1.
test('lowering max to the bottom limit raises max instead of leaving max <= min', () => {
  expect(reconcileMinMaxFreq('max', 1, 0)).toEqual({ minFreqPerMin: 1, maxFreqPerMin: 2 });
});

test('a below-minimum custom max (0.5) is clamped up before reconciling', () => {
  expect(reconcileMinMaxFreq('max', 5, 0.5)).toEqual({ minFreqPerMin: 1, maxFreqPerMin: 2 });
});

test('a custom max of exactly the bottom limit (1) is reconciled to a valid pair', () => {
  expect(reconcileMinMaxFreq('max', 5, 1)).toEqual({ minFreqPerMin: 1, maxFreqPerMin: 2 });
});

test('an above-maximum custom min (500) is clamped down before reconciling', () => {
  expect(reconcileMinMaxFreq('min', 500, 20)).toEqual({ minFreqPerMin: 199, maxFreqPerMin: 200 });
});

test('equal min/max values (changed min) reconcile to a valid ascending pair', () => {
  expect(reconcileMinMaxFreq('min', 10, 10)).toEqual({ minFreqPerMin: 10, maxFreqPerMin: 11 });
});

test('equal min/max values (changed max) reconcile to a valid ascending pair', () => {
  expect(reconcileMinMaxFreq('max', 10, 10)).toEqual({ minFreqPerMin: 9, maxFreqPerMin: 10 });
});

test('a fractional min at the top limit (199.5) does not push max past 200', () => {
  expect(reconcileMinMaxFreq('min', 199.5, 199.5)).toEqual({ minFreqPerMin: 199, maxFreqPerMin: 200 });
});

test('a fractional min just under the top limit (199.99) does not push max past 200', () => {
  expect(reconcileMinMaxFreq('min', 199.99, 150)).toEqual({ minFreqPerMin: 199, maxFreqPerMin: 200 });
});

test('a fractional max (1.4) does not push min below 1', () => {
  expect(reconcileMinMaxFreq('max', 2, 1.4)).toEqual({ minFreqPerMin: 1, maxFreqPerMin: 2 });
});

test('a fractional max just above the bottom limit (1.01) does not push min below 1', () => {
  expect(reconcileMinMaxFreq('max', 5, 1.01)).toEqual({ minFreqPerMin: 1, maxFreqPerMin: 2 });
});

test('result is always within [POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN] with max > min', () => {
  const cases: Array<['min' | 'max', number, number]> = [
    ['min', 0, 0],
    ['min', 500, 500],
    ['max', 0, 0],
    ['max', 500, 500],
    ['min', 200, 200],
    ['max', 1, 1],
    ['min', -5, 20],
    ['max', 20, -5],
    ['min', 199.5, 199.5],
    ['min', 199.99, 150],
    ['max', 2, 1.4],
    ['max', 5, 1.01],
    ['min', 199.01, 199.01],
    ['max', 1.99, 1.99],
  ];
  for (const [changed, min, max] of cases) {
    const result = reconcileMinMaxFreq(changed, min, max);
    expect(result.minFreqPerMin).toBeGreaterThanOrEqual(POLL_FREQ_MIN_PER_MIN);
    expect(result.maxFreqPerMin).toBeLessThanOrEqual(POLL_FREQ_MAX_PER_MIN);
    expect(result.maxFreqPerMin).toBeGreaterThan(result.minFreqPerMin);
  }
});
