import { POLL_FREQ_MIN_PER_MIN, POLL_FREQ_MAX_PER_MIN } from '../constants/limits';

function clampFreq(value: number): number {
  return Math.min(POLL_FREQ_MAX_PER_MIN, Math.max(POLL_FREQ_MIN_PER_MIN, value));
}

export function reconcileMinMaxFreq(
  changed: 'min' | 'max',
  minFreqPerMin: number,
  maxFreqPerMin: number
): { minFreqPerMin: number; maxFreqPerMin: number } {
  const min = clampFreq(minFreqPerMin);
  const max = clampFreq(maxFreqPerMin);

  if (min < max) {
    return { minFreqPerMin: min, maxFreqPerMin: max };
  }

  if (changed === 'min') {
    // Guard against fractional custom input (e.g. 199.5): "max = min + 1" alone
    // can push max past POLL_FREQ_MAX_PER_MIN when min is already within 1 of it,
    // for any min, not just an integer min at the exact limit.
    if (min > POLL_FREQ_MAX_PER_MIN - 1) {
      return { minFreqPerMin: POLL_FREQ_MAX_PER_MIN - 1, maxFreqPerMin: POLL_FREQ_MAX_PER_MIN };
    }
    return { minFreqPerMin: min, maxFreqPerMin: min + 1 };
  }

  // Same fractional guard, mirrored for "min = max - 1" pushing min below
  // POLL_FREQ_MIN_PER_MIN when max is already within 1 of it.
  if (max < POLL_FREQ_MIN_PER_MIN + 1) {
    return { minFreqPerMin: POLL_FREQ_MIN_PER_MIN, maxFreqPerMin: POLL_FREQ_MIN_PER_MIN + 1 };
  }
  return { minFreqPerMin: max - 1, maxFreqPerMin: max };
}
