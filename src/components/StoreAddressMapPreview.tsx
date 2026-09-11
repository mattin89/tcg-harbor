import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import maplibregl, {
  type Map as MapLibreMap,
  type Marker,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Icon } from './Icon';
import { isValidLatitude, isValidLongitude } from '../domain/storeGeocoding';
import '../styles-map.css';

const DEFAULT_CENTER: [number, number] = [13.7373, 51.0504]; // [lng, lat] (Dresden default)

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

export interface StoreAddressMapPreviewProps {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  onCoordinatesChange: (latitude: number, longitude: number) => void;
  addressLabel?: string;
  isGeocoding?: boolean;
  height?: number | string;
}

export function StoreAddressMapPreview({
  latitude,
  longitude,
  onCoordinatesChange,
  addressLabel,
  isGeocoding = false,
  height = 280,
}: StoreAddressMapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading');
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  const hasCoordinates = isValidLatitude(latitude) && isValidLongitude(longitude);
  const onCoordinatesChangeRef = useRef(onCoordinatesChange);
  onCoordinatesChangeRef.current = onCoordinatesChange;

  // Track online/offline status
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Initialize MapLibre
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!online) {
      setLoadState('offline');
      return;
    }

    let cancelled = false;
    let map: MapLibreMap | null = null;

    setLoadState('loading');
    try {
      const initialCenter: [number, number] = hasCoordinates
        ? [longitude!, latitude!]
        : DEFAULT_CENTER;

      map = new maplibregl.Map({
        container,
        style: osmRasterStyle(),
        center: initialCenter,
        zoom: hasCoordinates ? 14.5 : 12,
        minZoom: 3,
        maxZoom: 18,
        attributionControl: { compact: true },
        interactive: true,
      });

      mapRef.current = map;

      map.on('load', () => {
        if (cancelled || !map) return;
        setLoadState('ready');
        map.resize();
      });

      map.on('click', (event) => {
        const { lng, lat } = event.lngLat;
        onCoordinatesChangeRef.current(Number(lat.toFixed(6)), Number(lng.toFixed(6)));
      });

      map.on('error', () => {
        if (!cancelled) setLoadState('error');
      });
    } catch {
      if (!cancelled) setLoadState('error');
    }

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
      map?.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [online]);

  // Sync marker position when coordinates change or map loads
  useEffect(() => {
    const map = mapRef.current;
    if (!map || loadState !== 'ready') return;

    if (!hasCoordinates) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const pos: [number, number] = [longitude!, latitude!] as [number, number];

    if (!markerRef.current) {
      // Create custom pin element
      const el = document.createElement('div');
      el.className = 'store-preview-pin';
      el.setAttribute('aria-label', 'Store location pin');
      el.innerHTML = `
        <div class="store-preview-pin__pulse"></div>
        <div class="store-preview-pin__head">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            <circle cx="12" cy="9" r="2.5" fill="currentColor"/>
          </svg>
        </div>
      `;

      const marker = new maplibregl.Marker({
        element: el,
        draggable: true,
      })
        .setLngLat(pos)
        .addTo(map);

      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        onCoordinatesChangeRef.current(Number(lngLat.lat.toFixed(6)), Number(lngLat.lng.toFixed(6)));
      });

      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat(pos);
    }

    // Center map smoothly on coordinate change
    map.easeTo({ center: pos, duration: 400 });
  }, [hasCoordinates, latitude, longitude, loadState]);

  // Handle container resizing
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleRecenter = useCallback(() => {
    if (!mapRef.current || !hasCoordinates) return;
    mapRef.current.easeTo({ center: [longitude!, latitude!], zoom: 15, duration: 350 });
  }, [hasCoordinates, latitude, longitude]);

  const handleZoomIn = useCallback(() => {
    mapRef.current?.zoomIn({ duration: 250 });
  }, []);

  const handleZoomOut = useCallback(() => {
    mapRef.current?.zoomOut({ duration: 250 });
  }, []);

  return (
    <div className="store-address-map-preview" style={{ '--map-preview-height': typeof height === 'number' ? `${height}px` : height } as React.CSSProperties}>
      <div className="store-address-map-preview__header">
        <span className="store-address-map-preview__title">
          <Icon name="map" size={15} />
          <strong>Live store location map</strong>
        </span>
        {isGeocoding ? (
          <span className="store-address-map-preview__status is-loading">
            <Icon name="refresh" size={13} />
            Resolving address…
          </span>
        ) : hasCoordinates ? (
          <span className="store-address-map-preview__status is-matched">
            <Icon name="check" size={13} />
            Location mapped
          </span>
        ) : (
          <span className="store-address-map-preview__status is-idle">
            Awaiting address
          </span>
        )}
      </div>

      <div className="store-address-map-preview__canvas-wrap">
        <div ref={containerRef} className="store-address-map-preview__canvas" tabIndex={-1} aria-label="Interactive store location preview map" />

        <div className="store-address-map-preview__controls" aria-label="Map controls">
          <button type="button" onClick={handleZoomIn} aria-label="Zoom in">+</button>
          <button type="button" onClick={handleZoomOut} aria-label="Zoom out">−</button>
          {hasCoordinates && (
            <button type="button" onClick={handleRecenter} aria-label="Center on pin" title="Center on pin">
              <Icon name="locate" size={14} />
            </button>
          )}
        </div>

        {loadState === 'offline' && (
          <div className="store-address-map-preview__overlay">
            <Icon name="info" size={18} />
            <p>Offline · Map preview will appear once reconnected.</p>
          </div>
        )}
        {loadState === 'error' && (
          <div className="store-address-map-preview__overlay">
            <Icon name="info" size={18} />
            <p>Map tiles could not be loaded.</p>
          </div>
        )}
      </div>

      <footer className="store-address-map-preview__footer">
        <Icon name="info" size={14} />
        {hasCoordinates ? (
          <span>
            Pin placed at <strong>{latitude!.toFixed(5)}, {longitude!.toFixed(5)}</strong>.
            {addressLabel ? ` (${addressLabel})` : ''} Click on the map or drag the pin to fine-tune your entrance.
          </span>
        ) : (
          <span>
            Type your store address above, or click on the map / enter coordinates below to place the pin.
          </span>
        )}
      </footer>
    </div>
  );
}
