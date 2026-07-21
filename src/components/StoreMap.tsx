import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import maplibregl, {
  type Map as MapLibreMap,
  type Marker,
  type Popup,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Store } from '../data/demo';
import '../styles-map.css';

type Coordinate = [longitude: number, latitude: number];
const DRESDEN_CENTER: Coordinate = [13.7373, 51.0504];
type MapLoadState = 'loading' | 'ready' | 'offline' | 'error';

export type StoreMapStore = Omit<Store, 'longitude' | 'latitude'> & {
  /** Preferred real coordinate. Existing demo stores omit it and use a Dresden fixture point. */
  longitude?: number | null;
  /** Preferred real coordinate. Existing demo stores omit it and use a Dresden fixture point. */
  latitude?: number | null;
};

export interface StoreMapProps {
  stores: readonly StoreMapStore[];
  /** Omit for internal selection state; pass null for a controlled map with no selection. */
  selectedStoreId?: string | null;
  onSelectStore?: (store: StoreMapStore) => void;
  className?: string;
  height?: number | string;
  ariaLabel?: string;
  /** Signals that a responsive tab has made the map visible. */
  active?: boolean;
}

interface StoreLocation {
  store: StoreMapStore;
  coordinates: Coordinate;
  usesFallbackCoordinates: boolean;
}

function isValidLongitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

function isValidLatitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -85 && value <= 85;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable demo points within greater Dresden until store records gain real coordinates. */
function dresdenFallbackCoordinates(storeId: string): Coordinate {
  const hash = stableHash(storeId);
  const angle = ((hash % 3600) / 10) * (Math.PI / 180);
  const radius = 0.012 + ((hash >>> 9) % 9) * 0.004;
  const latitude = DRESDEN_CENTER[1] + Math.sin(angle) * radius;
  const longitude = DRESDEN_CENTER[0]
    + (Math.cos(angle) * radius) / Math.cos(DRESDEN_CENTER[1] * (Math.PI / 180));
  return [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))];
}

function locateStores(stores: readonly StoreMapStore[]): StoreLocation[] {
  return stores.map((store) => {
    const longitude = store.longitude;
    const latitude = store.latitude;
    const hasCoordinates = isValidLongitude(longitude) && isValidLatitude(latitude);
    const coordinates: Coordinate = hasCoordinates
      ? [longitude, latitude]
      : dresdenFallbackCoordinates(store.id);
    return {
      store,
      coordinates,
      usesFallbackCoordinates: !hasCoordinates,
    };
  });
}

function osmRasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      'osm-raster': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
      },
    },
    layers: [{ id: 'osm-raster-layer', type: 'raster', source: 'osm-raster' }],
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function fitLocations(map: MapLibreMap, locations: readonly StoreLocation[]): void {
  const duration = prefersReducedMotion() ? 0 : 550;
  if (locations.length === 0) {
    map.easeTo({ center: DRESDEN_CENTER, zoom: 11.6, duration });
    return;
  }
  if (locations.length === 1) {
    map.easeTo({ center: locations[0].coordinates, zoom: 13.8, duration });
    return;
  }

  const longitudes = locations.map(({ coordinates }) => coordinates[0]);
  const latitudes = locations.map(({ coordinates }) => coordinates[1]);
  map.fitBounds(
    [
      [Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)],
    ],
    // Keep a city-wide view even on high-DPI/narrow responsive canvases so every
    // registered Dresden marker remains visible after fitting.
    { padding: 72, maxZoom: 11.2, duration },
  );
}

function markerColor(accent: string): string {
  const palette: Record<string, string> = {
    coral: '#d96f51',
    gold: '#b9862f',
    violet: '#7657b8',
    azure: '#2677a8',
    jade: '#2e856d',
    amber: '#b36b22',
  };
  return palette[accent] ?? '#d96f51';
}

function createPopupContent(location: StoreLocation): HTMLElement {
  const { store, usesFallbackCoordinates } = location;
  const article = document.createElement('article');
  article.className = 'store-map-popup';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'store-map-popup__eyebrow';
  eyebrow.textContent = store.joined ? 'Joined community' : 'Local game store';

  const heading = document.createElement('h3');
  heading.textContent = store.name;

  const locationLine = document.createElement('p');
  locationLine.className = 'store-map-popup__location';
  locationLine.textContent = `${store.city}, ${store.country}`;

  const address = document.createElement('p');
  address.className = 'store-map-popup__address';
  address.textContent = store.address;

  article.append(eyebrow, heading, locationLine, address);
  if (store.source === 'registered') {
    const approved = document.createElement('p');
    approved.className = 'store-map-popup__fixture';
    approved.textContent = 'Approved TCG Harbor store';
    article.append(approved);
  } else {
    const metrics = document.createElement('dl');
    metrics.className = 'store-map-popup__metrics';
    for (const [label, value] of [
      ['Collectors', store.members.toLocaleString()],
      ['Open trades', store.trades.toLocaleString()],
    ]) {
      const metric = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = label;
      description.textContent = value;
      metric.append(term, description);
      metrics.append(metric);
    }
    article.append(metrics);
  }
  if (usesFallbackCoordinates) {
    const note = document.createElement('p');
    note.className = 'store-map-popup__fixture';
    note.textContent = 'Approximate Dresden demo position';
    article.append(note);
  }
  return article;
}

function fallbackHeading(state: MapLoadState, online: boolean): string {
  if (!online || state === 'offline') return 'Map unavailable offline';
  return 'Map could not be displayed';
}

interface StoreFallbackProps {
  state: MapLoadState;
  online: boolean;
  locations: readonly StoreLocation[];
  selectedStoreId: string | null;
  onSelect: (store: StoreMapStore) => void;
  onRetry: () => void;
}

function StoreFallback({
  state,
  online,
  locations,
  selectedStoreId,
  onSelect,
  onRetry,
}: StoreFallbackProps) {
  return (
    <div className="store-map__fallback">
      <div className="store-map__fallback-copy" role="status" aria-live="polite">
        <span className="store-map__fallback-icon" aria-hidden="true">⌖</span>
        <div>
          <h3>{fallbackHeading(state, online)}</h3>
          <p>
            {online
              ? 'Use the store list while the interactive map is unavailable.'
              : 'Reconnect to load MapLibre and OpenStreetMap tiles. Store details remain available below.'}
          </p>
        </div>
        {online && <button type="button" onClick={onRetry}>Retry map</button>}
      </div>
      {locations.length > 0 ? (
        <ul className="store-map__fallback-list" aria-label="Available stores">
          {locations.map(({ store, usesFallbackCoordinates }) => (
            <li key={store.id}>
              <button
                type="button"
                className={selectedStoreId === store.id ? 'is-selected' : undefined}
                onClick={() => onSelect(store)}
                aria-pressed={selectedStoreId === store.id}
              >
                <span>
                  <strong>{store.name}</strong>
                  <small>{store.city}, {store.country}</small>
                </span>
                <span>
                  {store.members.toLocaleString()} collectors
                  {usesFallbackCoordinates && <small>Approximate demo point</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="store-map__empty">No stores are available.</p>
      )}
    </div>
  );
}

export function StoreMap({
  stores,
  selectedStoreId,
  onSelectStore,
  className = '',
  height = 480,
  ariaLabel = 'Store map centered on Dresden',
  active = true,
}: StoreMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const markerElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const popupRef = useRef<Popup | null>(null);
  const locations = useMemo(() => locateStores(stores), [stores]);
  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<MapLoadState>('loading');
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [retryKey, setRetryKey] = useState(0);
  const descriptionId = useId();
  const isControlled = selectedStoreId !== undefined;
  const activeSelectedId = (isControlled ? selectedStoreId : internalSelectedId) ?? null;

  const selectStore = useCallback((store: StoreMapStore) => {
    if (!isControlled) setInternalSelectedId(store.id);
    onSelectStore?.(store);
  }, [isControlled, onSelectStore]);

  const retry = useCallback(() => setRetryKey((current) => current + 1), []);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      if (!mapRef.current) setRetryKey((current) => current + 1);
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width < 1 || entry.contentRect.height < 1) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const map = mapRef.current;
        if (!map) return;
        map.resize();
        fitLocations(map, locationsRef.current);
      });
    });
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (loadState !== 'ready' || !map || !container) return;
    const frame = window.requestAnimationFrame(() => {
      if (container.getBoundingClientRect().width < 1) return;
      map.resize();
      fitLocations(map, locationsRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, loadState, locations]);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let didLoad = false;
    let consecutiveMapErrors = 0;

    const clearMapArtifacts = () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      markerElementsRef.current.clear();
      popupRef.current?.remove();
      popupRef.current = null;
    };

    if (!online) {
      setLoadState('offline');
      return clearMapArtifacts;
    }

    setLoadState('loading');
    try {
      if (!mapContainerRef.current) return clearMapArtifacts;
      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: osmRasterStyle(),
        center: DRESDEN_CENTER,
        zoom: 11.6,
        minZoom: 3,
        maxZoom: 18,
        attributionControl: { compact: false },
        interactive: true,
        keyboard: true,
        dragPan: true,
        scrollZoom: true,
        touchZoomRotate: true,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      mapRef.current = map;
      map.on('load', () => {
        if (cancelled || !map) return;
        didLoad = true;
        consecutiveMapErrors = 0;
        const canvas = map.getCanvas();
        canvas.setAttribute('aria-label', ariaLabel);
        canvas.setAttribute('aria-describedby', descriptionId);
        canvas.tabIndex = 0;
        setLoadState('ready');
        window.requestAnimationFrame(() => {
          map?.resize();
          if (map) fitLocations(map, locationsRef.current);
        });
      });
      map.on('error', ({ error }) => {
        if (cancelled) return;
        consecutiveMapErrors += 1;
        if (didLoad && consecutiveMapErrors < 4) return;
        console.warn('TCG Harbor store map encountered an error.', error);
        setLoadState('error');
      });
    } catch (error: unknown) {
      if (!cancelled) {
        console.warn('TCG Harbor could not initialize MapLibre.', error);
        setLoadState('error');
      }
    }

    return () => {
      cancelled = true;
      clearMapArtifacts();
      map?.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [ariaLabel, descriptionId, online, retryKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (loadState !== 'ready' || !map) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    markerElementsRef.current.clear();

    for (const location of locations) {
      const { store, coordinates, usesFallbackCoordinates } = location;
      const markerButton = document.createElement('button');
      markerButton.type = 'button';
      markerButton.className = 'store-map__marker';
      markerButton.style.setProperty('--store-marker-color', markerColor(store.accent));
      markerButton.setAttribute(
        'aria-label',
        `Select ${store.name} in ${store.city}${usesFallbackCoordinates ? ', approximate Dresden demo position' : ''}`,
      );
      const initiallySelected = store.id === activeSelectedId;
      markerButton.classList.toggle('is-selected', initiallySelected);
      markerButton.setAttribute('aria-pressed', String(initiallySelected));
      markerButton.title = `${store.name} · ${store.city}`;

      const markerIcon = document.createElement('span');
      markerIcon.className = 'store-map__marker-icon';
      markerIcon.setAttribute('aria-hidden', 'true');
      const markerCore = document.createElement('span');
      markerCore.className = 'store-map__marker-core';
      markerIcon.append(markerCore);
      markerButton.append(markerIcon);
      markerButton.addEventListener('click', (event) => {
        event.stopPropagation();
        selectStore(store);
      });

      const marker = new maplibregl.Marker({ element: markerButton, anchor: 'bottom' })
        .setLngLat(coordinates)
        .addTo(map);
      markersRef.current.push(marker);
      markerElementsRef.current.set(store.id, markerButton);
    }

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      markerElementsRef.current.clear();
    };
  }, [loadState, locations, selectStore]);

  useEffect(() => {
    for (const [storeId, marker] of markerElementsRef.current) {
      const selected = storeId === activeSelectedId;
      marker.classList.toggle('is-selected', selected);
      marker.setAttribute('aria-pressed', String(selected));
    }

    popupRef.current?.remove();
    popupRef.current = null;
    const map = mapRef.current;
    const selectedLocation = locations.find(({ store }) => store.id === activeSelectedId);
    if (loadState !== 'ready' || !map || !selectedLocation) return;

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      focusAfterOpen: false,
      offset: 22,
      maxWidth: '300px',
    })
      .setLngLat(selectedLocation.coordinates)
      .setDOMContent(createPopupContent(selectedLocation))
      .addTo(map);
  }, [activeSelectedId, loadState, locations]);

  const zoom = (direction: 'in' | 'out') => {
    const duration = prefersReducedMotion() ? 0 : 250;
    if (direction === 'in') mapRef.current?.zoomIn({ duration });
    else mapRef.current?.zoomOut({ duration });
  };

  const mapHeight = typeof height === 'number' ? `${height}px` : height;
  const wrapperStyle = { '--store-map-height': mapHeight } as CSSProperties;
  const unavailable = !online || loadState === 'offline' || loadState === 'error';
  const controlsDisabled = loadState !== 'ready' || !online;

  return (
    <section
      className={`store-map ${className}`.trim()}
      style={wrapperStyle}
      role="region"
      aria-label={ariaLabel}
      aria-busy={loadState === 'loading'}
    >
      <p id={descriptionId} className="store-map__sr-only">
        Drag to pan, use the mouse wheel or zoom controls to zoom, and focus a store marker to select it.
        Stores without coordinates use deterministic demo points around Dresden.
      </p>
      <div ref={mapContainerRef} className="store-map__canvas" />

      <div className="store-map__controls" aria-label="Map controls">
        <button type="button" onClick={() => zoom('in')} disabled={controlsDisabled} aria-label="Zoom in" title="Zoom in">+</button>
        <button type="button" onClick={() => zoom('out')} disabled={controlsDisabled} aria-label="Zoom out" title="Zoom out">−</button>
        <button
          type="button"
          className="store-map__fit-control"
          onClick={() => mapRef.current && fitLocations(mapRef.current, locations)}
          disabled={controlsDisabled}
          aria-label="Fit all stores"
          title="Fit all stores"
        >
          <span aria-hidden="true">⌗</span>
          <span>All stores</span>
        </button>
      </div>

      {loadState === 'loading' && online && (
        <div className="store-map__loading" role="status" aria-live="polite">
          <span className="store-map__spinner" aria-hidden="true" />
          <strong>Loading the store map…</strong>
          <small>MapLibre and OpenStreetMap tiles</small>
        </div>
      )}

      {unavailable && (
        <StoreFallback
          state={loadState}
          online={online}
          locations={locations}
          selectedStoreId={activeSelectedId}
          onSelect={selectStore}
          onRetry={retry}
        />
      )}

      {loadState === 'ready' && online && (
        <p className="store-map__hint">Drag to explore · scroll to zoom</p>
      )}
    </section>
  );
}

export default StoreMap;
