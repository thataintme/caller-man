import { searchDestination } from './geocode';

beforeEach(() => {
  (global as any).fetch = jest.fn();
});

test('maps Mapbox geocoding features to lat/lng results', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      features: [{ center: [-0.1278, 51.5074], place_name: 'London, UK' }],
    }),
  });
  const results = await searchDestination('London', 'token');
  expect(results).toEqual([{ lat: 51.5074, lng: -0.1278, placeName: 'London, UK' }]);
});

test('throws with the status code when the request fails', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
  await expect(searchDestination('nowhere', 'token')).rejects.toThrow('500');
});

test('returns an empty array when no places match', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
  expect(await searchDestination('asdfghjkl', 'token')).toEqual([]);
});

test('returns an empty array without making a request for an empty or whitespace-only query', async () => {
  expect(await searchDestination('', 'token')).toEqual([]);
  expect(await searchDestination('   ', 'token')).toEqual([]);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('trims the query before sending the request', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
  await searchDestination('  London  ', 'token');
  const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
  expect(url).toContain(encodeURIComponent('London'));
  expect(url).not.toContain(encodeURIComponent('  London  '));
});

test('URL-encodes both the query and the access token', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
  await searchDestination('New York, NY', 'tok en/with?special');
  const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
  expect(url).toContain(encodeURIComponent('New York, NY'));
  expect(url).toContain(encodeURIComponent('tok en/with?special'));
  expect(url).not.toContain('tok en/with?special');
});

test('skips features whose center is not a two-number array', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
      features: [
        { center: [-0.1278], place_name: 'Malformed 1' },
        { center: 'nope', place_name: 'Malformed 2' },
        { center: null, place_name: 'Malformed 3' },
        { place_name: 'Missing center entirely' },
        { center: [-0.1278, 51.5074], place_name: 'Valid' },
      ],
    }),
  });
  const results = await searchDestination('somewhere', 'token');
  expect(results).toEqual([{ lat: 51.5074, lng: -0.1278, placeName: 'Valid' }]);
});
