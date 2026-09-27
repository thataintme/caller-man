export interface GeocodeResult {
  lat: number;
  lng: number;
  placeName: string;
}

export interface SearchNear {
  lat: number;
  lng: number;
}

// Mapbox Search Box API: unlike geocoding v5 (`mapbox.places`), it covers named
// points of interest — shopping centres, stations, stops — which are exactly
// what people pick as a destination.
const SEARCH_BOX_FORWARD_URL = 'https://api.mapbox.com/search/searchbox/v1/forward';
const RESULT_LIMIT = 5;

type SearchBoxFeature = {
  geometry: { coordinates: [number, number] };
  properties?: { name?: string; full_address?: string; place_formatted?: string };
};

function hasValidCoordinates(feature: any): feature is SearchBoxFeature {
  const coords = feature?.geometry?.coordinates;
  return (
    Array.isArray(coords) &&
    coords.length === 2 &&
    typeof coords[0] === 'number' &&
    typeof coords[1] === 'number'
  );
}

function labelFor(feature: SearchBoxFeature): string {
  const name = feature.properties?.name ?? '';
  const address = feature.properties?.full_address ?? feature.properties?.place_formatted;
  if (!address) return name;
  if (!name || address.startsWith(name)) return address;
  return `${name}, ${address}`;
}

export async function searchDestination(
  query: string,
  accessToken: string,
  near?: SearchNear
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let url =
    `${SEARCH_BOX_FORWARD_URL}?q=${encodeURIComponent(trimmed)}` +
    `&access_token=${encodeURIComponent(accessToken)}&limit=${RESULT_LIMIT}`;
  if (near) {
    // Rank places near the user first without excluding far-away ones.
    url += `&proximity=${encodeURIComponent(`${near.lng},${near.lat}`)}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocoding request failed: ${response.status}`);
  }
  const data = await response.json();
  return ((data.features ?? []) as any[]).filter(hasValidCoordinates).map((f) => ({
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    placeName: labelFor(f),
  }));
}
