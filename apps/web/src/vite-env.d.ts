/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base path or URL. Defaults to the same-origin `/api/v1` (proxied in development). */
  readonly VITE_API_BASE_URL?: string;
  /** MapLibre style URL (OpenFreeMap by default; Mapbox styles supported with a token). */
  readonly VITE_MAP_STYLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
