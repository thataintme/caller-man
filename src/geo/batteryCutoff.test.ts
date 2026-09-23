import { maxAllowedBatteryCutoffPct } from './batteryCutoff';

test('current battery above the default cutoff leaves the default unchanged', () => {
  expect(maxAllowedBatteryCutoffPct(50, 15)).toBe(15);
});

test('current battery already below the default cutoff caps at current minus 5', () => {
  expect(maxAllowedBatteryCutoffPct(10, 15)).toBe(5);
});

test('the cap never goes negative — floors at 0', () => {
  expect(maxAllowedBatteryCutoffPct(3, 15)).toBe(0);
  expect(maxAllowedBatteryCutoffPct(0, 15)).toBe(0);
});

test('current battery exactly equal to the default cutoff leaves it unchanged', () => {
  expect(maxAllowedBatteryCutoffPct(15, 15)).toBe(15);
});
