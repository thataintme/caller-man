export interface GeocodeResult {
  lat: number;
  lng: number;
  placeName: string;
}

function hasValidCenter(feature: any): feature is { center: [number, number]; place_name: string } {
  return (
    Array.isArray(feature?.center) &&
    feature.center.length === 2 &&
    typeof feature.center[0] === 'number' &&
    typeof feature.center[1] === 'number'
  );
}

export async function searchDestination(query: string, accessToken: string): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json?access_token=${encodeURIComponent(accessToken)}&limit=5`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocoding request failed: ${response.status}`);
  }
  const data = await response.json();
  return ((data.features ?? []) as any[]).filter(hasValidCenter).map((f) => ({
    lat: f.center[1],
    lng: f.center[0],
    placeName: f.place_name,
  }));
}
