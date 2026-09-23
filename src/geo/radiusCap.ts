import { RADIUS_MAX_FRACTION_OF_DISTANCE } from '../constants/limits';

export function maxAllowedRadiusM(distanceToDestinationM: number): number {
  return distanceToDestinationM * RADIUS_MAX_FRACTION_OF_DISTANCE;
}

export function clampRadiusToCap(radiusM: number, distanceToDestinationM: number): number {
  return Math.min(radiusM, maxAllowedRadiusM(distanceToDestinationM));
}
