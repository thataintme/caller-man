import { BATTERY_CUTOFF_SAFETY_MARGIN_PCT, BATTERY_CUTOFF_FLOOR_PCT } from '../constants/limits';

export function maxAllowedBatteryCutoffPct(
  currentBatteryPct: number,
  defaultCutoffPct: number
): number {
  if (currentBatteryPct >= defaultCutoffPct) {
    return defaultCutoffPct;
  }
  return Math.max(BATTERY_CUTOFF_FLOOR_PCT, currentBatteryPct - BATTERY_CUTOFF_SAFETY_MARGIN_PCT);
}
