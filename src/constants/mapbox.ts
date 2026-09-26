// Runtime *public* access token (`pk.…`) used by the Mapbox SDK and the
// geocoding search. The real token comes from the gitignored .env.local file
// as EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN; the placeholder below is only the
// fallback when that isn't set. Never invent or hardcode a real token here.
//
// No *download* token (`sk.…`) is needed to build: @rnmapbox/maps 10.3.x's
// config plugin adds Mapbox's Maven repo without authentication (Mapbox
// dropped the download-token requirement). If a build ever does need one,
// supply it outside the repo — the RNMAPBOX_MAPS_DOWNLOAD_TOKEN environment
// variable, or MAPBOX_DOWNLOADS_TOKEN in ~/.gradle/gradle.properties — never
// in app.json or anything else that is committed.
export const MAPBOX_ACCESS_TOKEN =
  process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? 'REPLACE_WITH_YOUR_MAPBOX_PUBLIC_ACCESS_TOKEN';

export function isMapboxTokenConfigured(): boolean {
  return MAPBOX_ACCESS_TOKEN !== '' && !MAPBOX_ACCESS_TOKEN.startsWith('REPLACE_');
}

// Task 30 (R30.3): the single style every map surface uses — the two
// MapViews (NewJourneyScreen, CurrentJourneyScreen) and the offline pack
// (offlineMapCache) all reference this constant, so what's cached always
// matches what's rendered. Equal to Mapbox.StyleURL.Street's value, but kept
// as a plain string rather than importing '@rnmapbox/maps' here: that native
// module throws when required without being mocked (see offlineMapCache.ts,
// where it's already required and mocked at the test boundary), and this
// constants file is intentionally free of that dependency so its own tests
// don't have to carry the mock too.
export const MAP_STYLE_URL = 'mapbox://styles/mapbox/streets-v11';
