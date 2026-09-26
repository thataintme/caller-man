import Mapbox from '@rnmapbox/maps';
import {
  cacheAreaForJourney,
  chooseMaxZoom,
  computeBounds,
  packNameForJourney,
  removeAreaCacheForJourney,
} from './offlineMapCache';
import { Journey } from '../types/journey';
import { MAP_STYLE_URL } from '../constants/mapbox';

jest.mock('@rnmapbox/maps', () => ({
  offlineManager: {
    createPack: jest.fn(),
    deletePack: jest.fn(),
  },
}));

const mockOfflineManager = (Mapbox as unknown as {
  offlineManager: { createPack: jest.Mock; deletePack: jest.Mock };
}).offlineManager;

const journey: Journey = {
  id: 7,
  name: 'Station',
  destinationLat: 51.515,
  destinationLng: -0.135,
  radiusM: 200,
  maxPollFreqPerMin: 20,
  minPollFreqPerMin: 5,
  alarmTune: 'Radar Ping',
  batteryCutoffPct: 15,
  snoozeMinutes: 3,
  gpsLossGraceMinutes: 2,
  initialDistanceM: 1000,
  lastFixAt: null,
  status: 'active',
  createdAt: 0,
  completedAt: null,
  arrivedAt: null,
};

const USER_LAT = 51.5074;
const USER_LNG = -0.1278;

beforeEach(() => {
  jest.clearAllMocks();
  mockOfflineManager.createPack.mockResolvedValue(undefined);
  mockOfflineManager.deletePack.mockResolvedValue(undefined);
});

test('packNameForJourney is stable and unique per journey id', () => {
  expect(packNameForJourney(7)).toBe('journey-7');
  expect(packNameForJourney(8)).toBe('journey-8');
});

test('computeBounds covers both the user and the destination, with padding', () => {
  const [[minLng, minLat], [maxLng, maxLat]] = computeBounds(51.5, -0.1, 51.6, -0.2);
  expect(minLng).toBeLessThan(-0.2);
  expect(minLat).toBeLessThan(51.5);
  expect(maxLng).toBeGreaterThan(-0.1);
  expect(maxLat).toBeGreaterThan(51.6);
});

describe('chooseMaxZoom (R30.4)', () => {
  test('a short trip (small bounding box) gets the full max zoom of 14', () => {
    const bounds = computeBounds(USER_LAT, USER_LNG, 51.515, -0.135); // ~1km away
    expect(chooseMaxZoom(bounds, 8, 6000)).toBe(14);
  });

  test('a long trip (large bounding box) settles for a lower max zoom to stay under the tile limit', () => {
    const bounds = computeBounds(USER_LAT, USER_LNG, 53.4808, -2.2426); // London -> Manchester, ~260km
    const zoom = chooseMaxZoom(bounds, 8, 6000);
    expect(zoom).toBeLessThan(14);
    expect(zoom).toBeGreaterThanOrEqual(8);
  });

  test('never returns below minZoom, even when minZoom itself overflows the tile limit', () => {
    const bounds = computeBounds(-85, -180, 85, 180); // the whole world
    expect(chooseMaxZoom(bounds, 8, 6000)).toBe(8);
  });
});

describe('cacheAreaForJourney', () => {
  test('deletes any existing pack for the journey before creating a new one (idempotent create, R30.5)', async () => {
    await cacheAreaForJourney(journey, USER_LAT, USER_LNG);

    expect(mockOfflineManager.deletePack).toHaveBeenCalledWith('journey-7');
    expect(mockOfflineManager.createPack).toHaveBeenCalledTimes(1);
    const deleteOrder = mockOfflineManager.deletePack.mock.invocationCallOrder[0];
    const createOrder = mockOfflineManager.createPack.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  test('creates the pack with the shared map style, computed bounds, and a chosen max zoom', async () => {
    await cacheAreaForJourney(journey, USER_LAT, USER_LNG);

    const expectedBounds = computeBounds(USER_LAT, USER_LNG, journey.destinationLat, journey.destinationLng);
    expect(mockOfflineManager.createPack).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'journey-7',
        styleURL: MAP_STYLE_URL,
        bounds: expectedBounds,
        minZoom: 8,
        maxZoom: 14,
      }),
      expect.any(Function)
    );
  });

  test('a stale-pack ("not found") deletePack rejection is ignored and createPack still runs (R30.5)', async () => {
    mockOfflineManager.deletePack.mockRejectedValueOnce(new Error('not found'));

    await expect(cacheAreaForJourney(journey, USER_LAT, USER_LNG)).resolves.toBeUndefined();
    expect(mockOfflineManager.createPack).toHaveBeenCalledTimes(1);
  });

  test('a createPack failure is swallowed — caching is best-effort and never throws (R30.2)', async () => {
    mockOfflineManager.createPack.mockRejectedValueOnce(new Error('offline'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(cacheAreaForJourney(journey, USER_LAT, USER_LNG)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('removeAreaCacheForJourney', () => {
  test('deletes the pack for the journey', async () => {
    await removeAreaCacheForJourney(7);
    expect(mockOfflineManager.deletePack).toHaveBeenCalledWith('journey-7');
  });

  test('a deletePack failure is swallowed — eviction is best-effort and never throws (R30.2)', async () => {
    mockOfflineManager.deletePack.mockRejectedValueOnce(new Error('boom'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(removeAreaCacheForJourney(7)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
