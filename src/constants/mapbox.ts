// Runtime *public* access token (`pk.…`) used by the Mapbox SDK and the
// geocoding search. This is a different credential from the *download*
// token (`sk.…`) already placed in app.json's @rnmapbox/maps plugin config
// (Task 2) — Mapbox issues both from the same account, for different
// purposes. The real token comes from the gitignored .env.local file as
// EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN; the placeholder below is only the
// fallback when that isn't set. Never invent or hardcode a real token here.
export const MAPBOX_ACCESS_TOKEN =
  process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? 'REPLACE_WITH_YOUR_MAPBOX_PUBLIC_ACCESS_TOKEN';

export function isMapboxTokenConfigured(): boolean {
  return MAPBOX_ACCESS_TOKEN !== '' && !MAPBOX_ACCESS_TOKEN.startsWith('REPLACE_');
}
