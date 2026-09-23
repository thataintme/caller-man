import { haversineDistanceM } from './haversine';

test('distance between identical points is 0', () => {
  expect(haversineDistanceM({ lat: 51.5, lng: -0.12 }, { lat: 51.5, lng: -0.12 })).toBe(0);
});

test('1 degree of latitude is approximately 111.32 km', () => {
  const d = haversineDistanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  expect(d).toBeGreaterThan(110_500);
  expect(d).toBeLessThan(111_500);
});

test('distance is symmetric', () => {
  const a = { lat: 51.5074, lng: -0.1278 };
  const b = { lat: 48.8566, lng: 2.3522 };
  expect(haversineDistanceM(a, b)).toBeCloseTo(haversineDistanceM(b, a), 6);
});
