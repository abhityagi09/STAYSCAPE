import { useEffect, useRef, useState } from 'react';
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup,
} from 'maplibre-gl';
import { getMapProvider } from '@/lib/map/provider';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { tr } from '@/lib/tr';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Short label (e.g. a price) rendered on the marker. */
  label: string;
  title: string;
  /** Optional secondary line in the popup (e.g. "Boutique · ★ 4.6"). */
  subtitle?: string;
  /** Link target for the popup's "View property" action. */
  href?: string;
}

export interface MapViewProps {
  markers: MapMarker[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Called (debounced) with [minLng, minLat, maxLng, maxLat] after the user moves the map. */
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
  center?: { lat: number; lng: number };
  zoom?: number;
  fitToMarkers?: boolean;
  className?: string;
  label: string;
  /** Single draggable pin mode (partner location picker). */
  onMapClick?: (point: { lat: number; lng: number }) => void;
  /** Called when the popup link of a marker is activated (SPA navigation instead of a reload). */
  onOpen?: (id: string, href: string) => void;
}

const SOURCE = 'hotels';

/**
 * MapLibre map with clustered, price-labelled markers. The library (~800 KB) is loaded on demand.
 * Map markers are not keyboard-navigable, so every page using this also renders an accessible list.
 */
/** Popup content built with DOM APIs: partner-supplied names are never parsed as HTML. */
function popupContent(marker: MapMarker, onOpen: MapViewProps['onOpen']): HTMLElement {
  const root = document.createElement('div');
  root.className = 'flex min-w-40 flex-col gap-0.5 font-sans text-fg';
  const title = document.createElement('p');
  title.className = 'text-sm font-semibold leading-snug';
  title.textContent = marker.title;
  root.append(title);
  if (marker.subtitle) {
    const sub = document.createElement('p');
    sub.className = 'text-xs text-fg-muted';
    sub.textContent = marker.subtitle;
    root.append(sub);
  }
  const price = document.createElement('p');
  price.className = 'text-sm font-semibold text-primary';
  price.textContent = marker.label;
  root.append(price);
  if (marker.href) {
    const link = document.createElement('a');
    link.href = marker.href;
    link.className = 'mt-1 text-xs font-semibold text-primary underline';
    link.textContent = 'View property';
    link.addEventListener('click', (event) => {
      if (!onOpen || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      onOpen(marker.id, marker.href!);
    });
    root.append(link);
  }
  return root;
}

export function MapView({
  markers,
  selectedId,
  onSelect,
  onBoundsChange,
  center,
  zoom = 11,
  fitToMarkers = true,
  className,
  label,
  onMapClick,
  onOpen,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const callbacks = useRef({ onSelect, onBoundsChange, onMapClick, onOpen });
  const popupRef = useRef<Popup | null>(null);
  const popupCtor = useRef<typeof Popup | null>(null);
  const userMoved = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbacks.current = { onSelect, onBoundsChange, onMapClick, onOpen };
  });

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    (async () => {
      try {
        const [maplibre, worker] = await Promise.all([
          import('maplibre-gl'),
          // MapLibre 6 loads its worker as a separate module; let Vite emit it as a hashed asset.
          import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
        ]);
        maplibre.setWorkerUrl(worker.default);
        await import('maplibre-gl/dist/maplibre-gl.css');
        if (cancelled || !container.current) return;
        popupCtor.current = maplibre.Popup;
        const provider = getMapProvider();
        map = new maplibre.Map({
          container: container.current,
          style: provider.styleUrl,
          center: center ? [center.lng, center.lat] : [78.9629, 22.5937],
          zoom: center ? zoom : 4,
          attributionControl: { compact: true, customAttribution: provider.attribution },
          cooperativeGestures: true,
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
        mapRef.current = map;
        map.on('error', () => undefined);
        map.on('load', () => {
          if (!map) return;
          map.addSource(SOURCE, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
            cluster: true,
            clusterRadius: 45,
            clusterMaxZoom: 13,
          });
          map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: SOURCE,
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': '#173D35',
              'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 30, 26],
              'circle-stroke-width': 3,
              'circle-stroke-color': '#F8F6F1',
            },
          });
          map.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: SOURCE,
            filter: ['has', 'point_count'],
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 13,
              'text-font': ['Noto Sans Bold'],
            },
            paint: { 'text-color': '#F8F6F1' },
          });
          map.addLayer({
            id: 'points',
            type: 'circle',
            source: SOURCE,
            filter: ['!', ['has', 'point_count']],
            paint: {
              'circle-color': [
                'case',
                ['boolean', ['get', 'selected'], false],
                '#C6A66B',
                '#FFFFFF',
              ],
              'circle-radius': 22,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#173D35',
            },
          });
          map.addLayer({
            id: 'labels',
            type: 'symbol',
            source: SOURCE,
            filter: ['!', ['has', 'point_count']],
            layout: {
              'text-field': ['get', 'label'],
              'text-size': 11,
              'text-font': ['Noto Sans Bold'],
              'text-allow-overlap': true,
            },
            paint: { 'text-color': '#173D35' },
          });
          map.on('click', 'clusters', async (e: MapLayerMouseEvent) => {
            const feature = e.features?.[0];
            const clusterId = feature?.properties?.cluster_id as number | undefined;
            if (clusterId === undefined || !map) return;
            const z = await (map.getSource(SOURCE) as GeoJSONSource).getClusterExpansionZoom(
              clusterId,
            );
            map.easeTo({
              center: (feature!.geometry as unknown as { coordinates: [number, number] })
                .coordinates,
              zoom: z,
            });
          });
          map.on('click', 'points', (e: MapLayerMouseEvent) => {
            const id = e.features?.[0]?.properties?.id as string | undefined;
            if (id) callbacks.current.onSelect?.(id);
          });
          for (const layer of ['clusters', 'points']) {
            map.on('mouseenter', layer, () => map && (map.getCanvas().style.cursor = 'pointer'));
            map.on('mouseleave', layer, () => map && (map.getCanvas().style.cursor = ''));
          }
          map.on('click', (e) =>
            callbacks.current.onMapClick?.({
              lat: Number(e.lngLat.lat.toFixed(6)),
              lng: Number(e.lngLat.lng.toFixed(6)),
            }),
          );
          map.on('dragstart', () => (userMoved.current = true));
          map.on('zoomstart', (e) => {
            if ((e as { originalEvent?: unknown }).originalEvent) userMoved.current = true;
          });
          map.on('moveend', () => {
            if (!userMoved.current || !map) return;
            if (debounce.current) clearTimeout(debounce.current);
            debounce.current = setTimeout(() => {
              const b = map!.getBounds();
              const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
              callbacks.current.onBoundsChange?.([
                clamp(b.getWest(), 180),
                clamp(b.getSouth(), 90),
                clamp(b.getEast(), 180),
                clamp(b.getNorth(), 90),
              ]);
            }, 500);
          });
          setStatus('ready');
        });
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
      if (debounce.current) clearTimeout(debounce.current);
      popupRef.current?.remove();
      popupRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // The map is created once; markers/selection are synced in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: markers.map((m) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
        properties: { id: m.id, label: m.label, title: m.title, selected: m.id === selectedId },
      })),
    });
    if (fitToMarkers && !userMoved.current && markers.length) {
      const lngs = markers.map((m) => m.lng);
      const lats = markers.map((m) => m.lat);
      const bounds: LngLatBoundsLike = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
    }
  }, [markers, selectedId, status, fitToMarkers]);

  // Popup for the selected marker (from a map click or a list hover/selection).
  useEffect(() => {
    const map = mapRef.current;
    const PopupClass = popupCtor.current;
    if (status !== 'ready' || !map || !PopupClass) return;
    const marker = selectedId ? markers.find((m) => m.id === selectedId) : undefined;
    if (!marker) {
      popupRef.current?.remove();
      popupRef.current = null;
      return;
    }
    popupRef.current ??= new PopupClass({
      className: 'stayscape-popup',
      closeButton: true,
      closeOnClick: false,
      focusAfterOpen: false,
      offset: 24,
      maxWidth: '16rem',
    });
    popupRef.current
      .setLngLat([marker.lng, marker.lat])
      .setDOMContent(popupContent(marker, (id, href) => callbacks.current.onOpen?.(id, href)));
    if (!popupRef.current.isOpen()) popupRef.current.addTo(map);
  }, [selectedId, markers, status]);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border bg-surface-muted',
        className,
      )}
    >
      {/* Inline style on purpose: MapLibre's unlayered `.maplibregl-map { position: relative }`
          overrides Tailwind's layered `absolute` class, collapsing the map to zero height. */}
      <div
        ref={container}
        style={{ position: 'absolute', inset: 0 }}
        role="region"
        aria-label={label}
      />
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-primary">
          <Spinner label={tr('Loading map')} />
        </div>
      )}
      {status === 'error' && (
        <div
          className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-fg-muted"
          role="alert"
        >
          {tr('The map could not be loaded. Results are still available in the list.')}
        </div>
      )}
    </div>
  );
}
