import { maxAllowedRadiusM, clampRadiusToCap } from './radiusCap';

test('max allowed radius is 40% of the distance', () => {
  expect(maxAllowedRadiusM(10_000)).toBe(4_000);
});

test('radius under the cap is left unchanged', () => {
  expect(clampRadiusToCap(2_000, 10_000)).toBe(2_000);
});

test('radius over the cap is clamped down to the cap', () => {
  expect(clampRadiusToCap(9_000, 10_000)).toBe(4_000);
});

test('destination at the current location caps radius to 0', () => {
  expect(clampRadiusToCap(5_000, 0)).toBe(0);
});
