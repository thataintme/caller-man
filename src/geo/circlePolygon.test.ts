import { circlePolygon } from './circlePolygon';
import { haversineDistanceM } from './haversine';

const center = { lat: 51.5074, lng: -0.1278 }; // London
const radiusM = 500;

test('returns a closed ring (first vertex equals the last)', () => {
  const ring = circlePolygon(center, radiusM);
  expect(ring.length).toBeGreaterThan(3);
  expect(ring[0]).toEqual(ring[ring.length - 1]);
});

test('every vertex is within ~1% of radiusM from the center', () => {
  const ring = circlePolygon(center, radiusM);
  for (const [lng, lat] of ring) {
    const distance = haversineDistanceM(center, { lat, lng });
    expect(distance).toBeGreaterThan(radiusM * 0.99);
    expect(distance).toBeLessThan(radiusM * 1.01);
  }
});

test('respects the points parameter (N points + 1 closing vertex)', () => {
  const ring = circlePolygon(center, radiusM, 8);
  expect(ring.length).toBe(9);
});

test('holds for a small radius too', () => {
  const smallRadiusM = 50;
  const ring = circlePolygon(center, smallRadiusM);
  for (const [lng, lat] of ring) {
    const distance = haversineDistanceM(center, { lat, lng });
    expect(distance).toBeGreaterThan(smallRadiusM * 0.99);
    expect(distance).toBeLessThan(smallRadiusM * 1.01);
  }
});
