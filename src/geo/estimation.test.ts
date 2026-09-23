import { averageSpeedMps, estimateEta, Fix } from './estimation';

const now = 1_000_000;

test('fewer than 2 fixes cannot produce a speed estimate', () => {
  const fixes: Fix[] = [{ lat: 0, lng: 0, recordedAt: now }];
  expect(averageSpeedMps(fixes, now)).toBeNull();
});

test('two fixes 1000m apart over 100s yields 10 m/s', () => {
  const fixes: Fix[] = [
    { lat: 0, lng: 0, recordedAt: now - 100_000 },
    { lat: 0.008983, lng: 0, recordedAt: now }, // ~1000m north at the equator
  ];
  expect(averageSpeedMps(fixes, now)).toBeCloseTo(10, 0);
});

test('fixes older than the estimation window are excluded', () => {
  const fixes: Fix[] = [
    { lat: 0, lng: 0, recordedAt: now - 10 * 60_000 }, // 10 min ago, outside window
    { lat: 0.008983, lng: 0, recordedAt: now },
  ];
  expect(averageSpeedMps(fixes, now)).toBeNull();
});

test('estimateEta returns null when speed is unknown or effectively stationary', () => {
  expect(estimateEta(1000, 200, null)).toBeNull();
  expect(estimateEta(1000, 200, 0.05)).toBeNull();
});

test('estimateEta computes arrival and alarm times from remaining distance and speed', () => {
  const eta = estimateEta(1000, 200, 10);
  expect(eta).toEqual({ etaSeconds: 100, alarmEtaSeconds: 80 });
});

test('estimateEta never returns a negative alarm ETA once already inside the radius', () => {
  const eta = estimateEta(100, 200, 10);
  expect(eta?.alarmEtaSeconds).toBe(0);
});
