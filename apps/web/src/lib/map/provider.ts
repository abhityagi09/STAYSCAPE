/**
 * Map provider abstraction. The web app renders maps with MapLibre GL, which can consume any
 * vector style:
 *  - default: OpenFreeMap (no API key, OpenStreetMap data);
 *  - Mapbox: set VITE_MAP_STYLE_URL to a Mapbox style URL with your access token;
 *  - any other MapLibre-compatible provider (MapTiler, Stadia, self-hosted).
 */
export interface MapProviderConfig {
  styleUrl: string;
  attribution: string;
}

export function getMapProvider(): MapProviderConfig {
  const styleUrl: string =
    import.meta.env.VITE_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
  const attribution = styleUrl.includes('mapbox.com')
    ? '© Mapbox © OpenStreetMap contributors'
    : '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';
  return { styleUrl, attribution };
}
