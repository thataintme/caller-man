import { POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN } from '../constants/limits';

function clampFreq(value: number): number {
  return Math.min(POLL_FREQ_MAX_PER_MIN, Math.max(POLL_FREQ_MIN_PER_MIN, value));
}

export function reconcileMinMaxFreq(
  changed: 'min' | 'max',
  minFreqPerMin: number,
  maxFreqPerMin: number
): { minFreqPerMin: number; maxFreqPerMin: number } {
  let min = clampFreq(minFreqPerMin);
  let max = clampFreq(maxFreqPerMin);

  if (min < max) {
    return { minFreqPerMin: min, maxFreqPerMin: max };
  }

  if (changed === 'min') {
    if (min >= POLL_FREQ_MAX_PER_MIN) {
      min = POLL_FREQ_MAX_PER_MIN - 1;
      max = POLL_FREQ_MAX_PER_MIN;
    } else {
      max = min + 1;
    }
  } else {
    if (max <= POLL_FREQ_MIN_PER_MIN) {
      max = POLL_FREQ_MIN_PER_MIN + 1;
      min = POLL_FREQ_MIN_PER_MIN;
    } else {
      min = max - 1;
    }
  }

  return { minFreqPerMin: min, maxFreqPerMin: max };
}
