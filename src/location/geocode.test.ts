import { searchDestination } from './geocode';

beforeEach(() => {
  (global as any).fetch = jest.fn();
});

function mockFeatures(features: unknown[]) {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ features }) });
}

function requestedUrl(): string {
  return (global.fetch as jest.Mock).mock.calls[0][0] as string;
}

// Shape taken from a real Search Box /forward response for this query near Dublin.
const LIFFEY_VALLEY = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-6.39231599, 53.35269219] },
  properties: {
    name: 'Liffey Valley Shopping Centre',
    full_address: 'Fonthill Rd, Palmerston, D22, Ireland',
    place_formatted: 'Palmerston, D22, Ireland',
    feature_type: 'poi',
  },
};

test('maps Search Box features to lat/lng results labelled with name and address', async () => {
  mockFeatures([LIFFEY_VALLEY]);
  const results = await searchDestination('Liffey Valley Shopping Centre', 'token');
  expect(results).toEqual([
    {
      lat: 53.35269219,
      lng: -6.39231599,
      placeName: 'Liffey Valley Shopping Centre, Fonthill Rd, Palmerston, D22, Ireland',
    },
  ]);
});

test('queries the Search Box forward endpoint (better point-of-interest coverage than geocoding v5)', async () => {
  mockFeatures([]);
  await searchDestination('Liffey Valley', 'token');
  expect(requestedUrl()).toMatch(/^https:\/\/api\.mapbox\.com\/search\/searchbox\/v1\/forward\?/);
  expect(requestedUrl()).toContain('limit=5');
});

test('biases results toward the given position via proximity=lng,lat', async () => {
  mockFeatures([]);
  await searchDestination('Liffey Valley', 'token', { lat: 53.35, lng: -6.26 });
  expect(requestedUrl()).toContain(`proximity=${encodeURIComponent('-6.26,53.35')}`);
});

test('sends no proximity when no position is given', async () => {
  mockFeatures([]);
  await searchDestination('Liffey Valley', 'token');
  expect(requestedUrl()).not.toContain('proximity=');
});

test('falls back to place_formatted, then the bare name, when full_address is missing', async () => {
  mockFeatures([
    { geometry: { coordinates: [1, 2] }, properties: { name: 'A', place_formatted: 'Town, Country' } },
    { geometry: { coordinates: [3, 4] }, properties: { name: 'B' } },
  ]);
  const results = await searchDestination('x', 'token');
  expect(results.map((r) => r.placeName)).toEqual(['A, Town, Country', 'B']);
});

test('does not repeat the name when the address already starts with it', async () => {
  mockFeatures([
    {
      geometry: { coordinates: [1, 2] },
      properties: { name: 'Dublin', full_address: 'Dublin, County Dublin, Ireland' },
    },
  ]);
  const [result] = await searchDestination('Dublin', 'token');
  expect(result.placeName).toBe('Dublin, County Dublin, Ireland');
});

test('throws with the status code when the request fails', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
  await expect(searchDestination('nowhere', 'token')).rejects.toThrow('500');
});

test('returns an empty array when no places match', async () => {
  mockFeatures([]);
  expect(await searchDestination('asdfghjkl', 'token')).toEqual([]);
});

test('returns an empty array without making a request for an empty or whitespace-only query', async () => {
  expect(await searchDestination('', 'token')).toEqual([]);
  expect(await searchDestination('   ', 'token')).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('trims the query before sending the request', async () => {
  mockFeatures([]);
  await searchDestination('  London  ', 'token');
  expect(requestedUrl()).toContain(`q=${encodeURIComponent('London')}&`);
});

test('URL-encodes both the query and the access token', async () => {
  mockFeatures([]);
  await searchDestination('New York, NY', 'tok en/with?special');
  expect(requestedUrl()).toContain(encodeURIComponent('New York, NY'));
  expect(requestedUrl()).toContain(encodeURIComponent('tok en/with?special'));
  expect(requestedUrl()).not.toContain('tok en/with?special');
});

test('skips features whose coordinates are not a two-number array', async () => {
  mockFeatures([
    { geometry: { coordinates: [-0.1278] }, properties: { name: 'Malformed 1' } },
    { geometry: { coordinates: 'nope' }, properties: { name: 'Malformed 2' } },
    { geometry: null, properties: { name: 'Malformed 3' } },
    { properties: { name: 'Missing geometry entirely' } },
    { geometry: { coordinates: [-0.1278, 51.5074] }, properties: { name: 'Valid' } },
  ]);
  const results = await searchDestination('somewhere', 'token');
  expect(results).toEqual([{ lat: 51.5074, lng: -0.1278, placeName: 'Valid' }]);
});
