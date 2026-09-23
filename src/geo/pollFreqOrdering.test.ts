import { reconcileMinMaxFreq } from './pollFreqOrdering';

test('leaves a valid min < max pair unchanged', () => {
  expect(reconcileMinMaxFreq('min', 5, 20)).toEqual({ minFreqPerMin: 5, maxFreqPerMin: 20 });
});

test('raising min above max pulls max up with it', () => {
  expect(reconcileMinMaxFreq('min', 25, 20)).toEqual({ minFreqPerMin: 25, maxFreqPerMin: 26 });
});

test('lowering max below min pulls min down with it', () => {
  expect(reconcileMinMaxFreq('max', 5, 3)).toEqual({ minFreqPerMin: 2, maxFreqPerMin: 3 });
});

test('lowering max never pulls min below 1', () => {
  expect(reconcileMinMaxFreq('max', 1, 0)).toEqual({ minFreqPerMin: 1, maxFreqPerMin: 0 });
});
