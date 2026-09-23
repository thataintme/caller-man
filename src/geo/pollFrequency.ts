export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

export function interpolatePollFreqPerMin(
  remainingDistanceM: number,
  initialDistanceM: number,
  minFreqPerMin: number,
  maxFreqPerMin: number
): number {
  if (initialDistanceM <= 0) {
    return maxFreqPerMin;
  }
  const traveledRatio = clamp01(1 - remainingDistanceM / initialDistanceM);
  return minFreqPerMin + (maxFreqPerMin - minFreqPerMin) * traveledRatio;
}

export function freqPerMinToIntervalMs(freqPerMin: number): number {
  if (freqPerMin <= 0) {
    throw new Error('freqPerMin must be > 0');
  }
  return Math.round(60_000 / freqPerMin);
}
