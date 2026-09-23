export function reconcileMinMaxFreq(
  changed: 'min' | 'max',
  minFreqPerMin: number,
  maxFreqPerMin: number
): { minFreqPerMin: number; maxFreqPerMin: number } {
  if (minFreqPerMin < maxFreqPerMin) {
    return { minFreqPerMin, maxFreqPerMin };
  }
  if (changed === 'min') {
    return { minFreqPerMin, maxFreqPerMin: minFreqPerMin + 1 };
  }
  return { minFreqPerMin: Math.max(1, maxFreqPerMin - 1), maxFreqPerMin };
}
