const ENV_KEY = 'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN';
const ORIGINAL_VALUE = process.env[ENV_KEY];

function loadModule(): typeof import('./mapbox') {
  let mod!: typeof import('./mapbox');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('./mapbox');
  });
  return mod;
}

afterEach(() => {
  if (ORIGINAL_VALUE === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_VALUE;
  }
});

test('falls back to the placeholder token and is not configured when the env var is unset', () => {
  delete process.env[ENV_KEY];
  const { MAPBOX_ACCESS_TOKEN, isMapboxTokenConfigured } = loadModule();
  expect(MAPBOX_ACCESS_TOKEN).toBe('REPLACE_WITH_YOUR_MAPBOX_PUBLIC_ACCESS_TOKEN');
  expect(isMapboxTokenConfigured()).toBe(false);
});

test('is not configured when the env var is an empty string', () => {
  process.env[ENV_KEY] = '';
  const { MAPBOX_ACCESS_TOKEN, isMapboxTokenConfigured } = loadModule();
  expect(MAPBOX_ACCESS_TOKEN).toBe('');
  expect(isMapboxTokenConfigured()).toBe(false);
});

test('uses the env var value and is configured when it is set to a real token', () => {
  process.env[ENV_KEY] = 'pk.unit-test-fake-token';
  const { MAPBOX_ACCESS_TOKEN, isMapboxTokenConfigured } = loadModule();
  expect(MAPBOX_ACCESS_TOKEN).toBe('pk.unit-test-fake-token');
  expect(isMapboxTokenConfigured()).toBe(true);
});

test('MAP_STYLE_URL is the shared Mapbox Street style (R30.3)', () => {
  const { MAP_STYLE_URL } = loadModule();
  expect(MAP_STYLE_URL).toBe('mapbox://styles/mapbox/streets-v11');
});
