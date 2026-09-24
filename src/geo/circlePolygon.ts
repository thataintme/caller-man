import { LatLng } from './haversine';

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Builds a closed GeoJSON Polygon ring (array of [lng, lat] pairs, first
 * point repeated as the last) approximating a circle of radiusM meters
 * around center, for rendering a journey's arrival radius on a map.
 *
 * Uses the spherical destination-point formula at `points` evenly spaced
 * bearings; CircleLayer's circleRadius is in screen pixels, not meters, so a
 * geodesic polygon (rendered via FillLayer/LineLayer) is what actually
 * represents a radius in meters on the map.
 */
export function circlePolygon(center: LatLng, radiusM: number, points = 64): [number, number][] {
  const lat1 = toRadians(center.lat);
  const lng1 = toRadians(center.lng);
  const angularDistance = radiusM / EARTH_RADIUS_M;

  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const bearing = toRadians((i * 360) / points);
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
      );
    ring.push([toDegrees(lng2), toDegrees(lat2)]);
  }
  return ring;
}
