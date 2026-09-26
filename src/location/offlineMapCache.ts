import Mapbox from '@rnmapbox/maps';
import { Journey } from '../types/journey';
import { MAP_STYLE_URL } from '../constants/mapbox';

/**
 * Offline map caching for the active journey's area (spec §2): downloads the
 * tiles covering the user's start position and the destination so the map on
 * CurrentJourneyScreen keeps rendering with no connectivity mid-journey.
 * Caching/eviction are both best-effort (R30.2) — a slow, failed or offline
 * pack operation must never surface as an error or block starting,
 * cancelling or dismissing a journey; the app still works online without a
 * cache, this is purely a resilience aid.
 */

const PADDING_DEGREES = 0.02;
const MIN_ZOOM = 8;
const MAX_ZOOM_CAP = 14;
// Mapbox's default per-region tile-count ceiling (R30.4); createPack fails
// once a region's estimated tile count exceeds this.
const TILE_COUNT_LIMIT = 6000;

export type LngLatBounds = [[number, number], [number, number]];

export function packNameForJourney(journeyId: number): string {
  return `journey-${journeyId}`;
}

export function computeBounds(
  userLat: number,
  userLng: number,
  destLat: number,
  destLng: number
): LngLatBounds {
  const minLat = Math.min(userLat, destLat) - PADDING_DEGREES;
  const maxLat = Math.max(userLat, destLat) + PADDING_DEGREES;
  const minLng = Math.min(userLng, destLng) - PADDING_DEGREES;
  const maxLng = Math.max(userLng, destLng) + PADDING_DEGREES;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

// Standard Web-Mercator slippy-map tile math (used by Mapbox/OSM tile
// servers): converts a longitude/latitude to the tile column/row that
// contains it at a given zoom level.
function lonToTileX(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom
  );
}

function tileCountAtZoom(bounds: LngLatBounds, zoom: number): number {
  const [[minLng, minLat], [maxLng, maxLat]] = bounds;
  const minX = lonToTileX(minLng, zoom);
  const maxX = lonToTileX(maxLng, zoom);
  // Tile Y grows southward, so the greater latitude maps to the smaller Y.
  const minY = latToTileY(maxLat, zoom);
  const maxY = latToTileY(minLat, zoom);
  return (maxX - minX + 1) * (maxY - minY + 1);
}

// An offline pack downloads every zoom level from minZoom up to maxZoom, so
// the tile-count ceiling applies to the sum across that whole range, not
// just the top zoom level.
function cumulativeTileCount(bounds: LngLatBounds, minZoom: number, maxZoom: number): number {
  let total = 0;
  for (let zoom = minZoom; zoom <= maxZoom; zoom++) {
    total += tileCountAtZoom(bounds, zoom);
  }
  return total;
}

/**
 * Highest zoom (<= 14, >= minZoom) whose cumulative tile count over
 * [minZoom, zoom] fits under tileLimit (R30.4). A long journey's bounding
 * box needs a lower max zoom than a short one to stay under the same limit;
 * if even minZoom alone overflows it, minZoom is returned as the floor.
 */
export function chooseMaxZoom(bounds: LngLatBounds, minZoom: number, tileLimit: number): number {
  for (let zoom = MAX_ZOOM_CAP; zoom > minZoom; zoom--) {
    if (cumulativeTileCount(bounds, minZoom, zoom) <= tileLimit) {
      return zoom;
    }
  }
  return minZoom;
}

export async function cacheAreaForJourney(
  journey: Journey,
  userLat: number,
  userLng: number
): Promise<void> {
  try {
    const bounds = computeBounds(userLat, userLng, journey.destinationLat, journey.destinationLng);
    const maxZoom = chooseMaxZoom(bounds, MIN_ZOOM, TILE_COUNT_LIMIT);
    const name = packNameForJourney(journey.id);

    // Idempotent create (R30.5): clear any pack already registered under this
    // name first (e.g. a retried start, or a restarted journey reusing an
    // id) so createPack can't collide with a stale pack of the same name.
    // Any failure here (including "not found") is ignored — the goal is
    // just a clean slate, not a successful delete.
    try {
      await Mapbox.offlineManager.deletePack(name);
    } catch {
      // ignore — nothing to clean up, or the pack didn't exist
    }

    await Mapbox.offlineManager.createPack(
      {
        name,
        styleURL: MAP_STYLE_URL,
        bounds,
        minZoom: MIN_ZOOM,
        maxZoom,
      },
      () => {
        // No progress UI for the MVP; the download runs in the background.
      }
    );
  } catch (err) {
    // Best effort (R30.2): a slow, offline or failed download must never
    // surface to the user or block starting a journey.
    console.warn('cacheAreaForJourney failed', err);
  }
}

export async function removeAreaCacheForJourney(journeyId: number): Promise<void> {
  try {
    await Mapbox.offlineManager.deletePack(packNameForJourney(journeyId));
  } catch (err) {
    // Best effort (R30.2): eviction failure must never surface as a
    // cancel/dismiss error.
    console.warn('removeAreaCacheForJourney failed', err);
  }
}
