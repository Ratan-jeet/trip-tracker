'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LivePosition, TripRoute } from '@/lib/api';
import { formatSpeed, initialsOf, isStale } from '@/lib/format';

interface MapViewProps {
  locations: LivePosition[];
  followDeviceId: string | null;
  route: TripRoute | null;
  routeGeometry: Array<[number, number]>;
  centerOn: { lat: number; lng: number; nonce: number } | null;
  heading: number | null;
  currentUserId?: string;
  onSelectDevice?: (deviceId: string) => void;
  onMapReady?: (map: maplibregl.Map) => void;
}

const ROUTE_SOURCE = 'trip-route';
const ROUTE_LAYER = 'trip-route-line';
const ROUTE_CASING = 'trip-route-casing';

/** Both tile sets are free to use; neither needs an account or a token. */
const BASEMAPS = {
  light: {
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors',
  },
  dark: {
    tiles: ['https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png'],
    attribution: '© OpenStreetMap contributors, © CARTO',
  },
} as const;

/** Reads a CSS custom property so the map matches the app theme. */
function themeColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `hsl(${value})` : fallback;
}

function prefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  const explicit = document.documentElement.getAttribute('data-theme');
  if (explicit === 'dark') return true;
  if (explicit === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Marker element, built once per device and mutated in place.
 *
 * The previous implementation interpolated `ownerName` and `deviceName` straight into
 * `innerHTML` on every update. Those values are set by other members, which made the map
 * a stored-XSS sink — and with the session token in localStorage, one crafted display
 * name was enough to take over every other member's account. Nothing here is parsed as
 * HTML: text goes through textContent.
 */
function createMarkerElement(): {
  root: HTMLDivElement;
  update: (position: LivePosition, opts: { isSelf: boolean; stale: boolean }) => void;
} {
  const root = document.createElement('div');
  root.className = 'flex flex-col items-center gap-1 cursor-pointer';

  const puck = document.createElement('div');
  puck.className = 'relative grid h-9 w-9 place-items-center rounded-full border-[3px] border-white shadow-md';

  const pulse = document.createElement('span');
  pulse.className = 'absolute inset-0 rounded-full animate-pulse-ring';
  puck.appendChild(pulse);

  const initials = document.createElement('span');
  initials.className = 'relative text-[11px] font-bold leading-none text-white';
  puck.appendChild(initials);

  const battery = document.createElement('span');
  battery.className =
    'absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-[9px] font-bold leading-[14px] text-slate-700 shadow';
  puck.appendChild(battery);

  const label = document.createElement('span');
  label.className =
    'max-w-[110px] truncate rounded-md bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-slate-800 shadow-sm';

  const speed = document.createElement('span');
  speed.className = 'rounded bg-black/55 px-1 text-[9px] font-medium leading-4 text-white tabular';

  root.append(puck, label, speed);

  return {
    root,
    update(position, { isSelf, stale }) {
      const color = stale
        ? '#94a3b8'
        : position.deviceType === 'vehicle'
          ? themeColor('--vehicle', '#f97316')
          : isSelf
            ? themeColor('--live', '#16a34a')
            : themeColor('--accent', '#2563eb');

      puck.style.background = color;
      pulse.style.background = color;
      pulse.style.display = stale ? 'none' : '';
      root.style.opacity = stale ? '0.65' : '1';

      // textContent, never innerHTML.
      initials.textContent =
        position.deviceType === 'vehicle' ? '▲' : initialsOf(position.ownerName || position.deviceName);
      label.textContent = position.ownerName || position.deviceName || 'Unknown device';

      const speedText = formatSpeed(position.speed);
      speed.textContent = speedText ?? '';
      speed.style.display = speedText ? '' : 'none';

      if (position.batteryLevel == null) {
        battery.style.display = 'none';
      } else {
        battery.style.display = '';
        battery.textContent = `${position.batteryLevel}%`;
      }

      // Only the vehicle glyph rotates; rotating a text badge makes it unreadable.
      initials.style.transform =
        position.deviceType === 'vehicle' && position.heading != null ? `rotate(${position.heading}deg)` : '';
    },
  };
}

export default function MapView({
  locations,
  followDeviceId,
  route,
  routeGeometry,
  centerOn,
  heading,
  currentUserId,
  onSelectDevice,
  onMapReady,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; update: ReturnType<typeof createMarkerElement>['update'] }>());
  const destinationMarker = useRef<maplibregl.Marker | null>(null);
  const smoothedBearing = useRef<number | null>(null);
  const hasFitted = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  // --- map instance -------------------------------------------------------
  useEffect(() => {
    if (!container.current || map.current) return;

    const basemap = BASEMAPS[prefersDark() ? 'dark' : 'light'];
    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [...basemap.tiles],
            tileSize: 256,
            attribution: basemap.attribution,
          },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap', minzoom: 0, maxzoom: 19 }],
      },
      center: [78.9629, 22.5937],
      zoom: 4,
      attributionControl: { compact: true },
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');
    instance.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');

    instance.on('load', () => {
      // A GeoJSON source + line layer. The previous version projected every route
      // coordinate to screen space and rebuilt an SVG polyline on every move, zoom and
      // rotate frame, which is why the route flickered and lagged while panning.
      instance.addSource(ROUTE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      instance.addLayer({
        id: ROUTE_CASING,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.85 },
      });
      instance.addLayer({
        id: ROUTE_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': themeColor('--accent', '#2563eb'), 'line-width': 5 },
      });
      setReady(true);
      onMapReady?.(instance);
    });

    map.current = instance;
    // Captured now: the ref may point elsewhere by the time cleanup runs.
    const markerRegistry = markers.current;
    return () => {
      instance.remove();
      map.current = null;
      markerRegistry.clear();
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- basemap follows the theme -----------------------------------------
  // The tile set was chosen once at mount, so toggling the theme left a light basemap
  // under a dark interface until the page was reloaded. Watch both the `data-theme`
  // attribute the toggle sets and the OS preference behind the "system" setting.
  useEffect(() => {
    if (!ready) return;

    const applyTheme = () => {
      const instance = map.current;
      if (!instance) return;
      const next = BASEMAPS[prefersDark() ? 'dark' : 'light'];
      // setTiles swaps the imagery without rebuilding the style, so the route layer,
      // markers and current camera all survive.
      const source = instance.getSource('basemap') as { setTiles?: (tiles: string[]) => void } | undefined;
      source?.setTiles?.([...next.tiles]);
      if (instance.getLayer(ROUTE_LAYER)) {
        instance.setPaintProperty(ROUTE_LAYER, 'line-color', themeColor('--accent', '#2563eb'));
      }
    };

    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', applyTheme);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', applyTheme);
    };
  }, [ready]);

  // --- route line ---------------------------------------------------------
  useEffect(() => {
    if (!map.current || !ready) return;
    const source = map.current.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    source.setData(
      routeGeometry.length > 1
        ? {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeGeometry } }],
          }
        : { type: 'FeatureCollection', features: [] },
    );
  }, [routeGeometry, ready]);

  // --- destination marker -------------------------------------------------
  useEffect(() => {
    if (!map.current || !ready) return;

    destinationMarker.current?.remove();
    destinationMarker.current = null;
    if (!route) return;

    const el = document.createElement('div');
    el.className = 'grid h-8 w-8 place-items-center rounded-full bg-white shadow-md ring-2 ring-black/10';
    const pin = document.createElement('span');
    pin.className = 'text-base leading-none';
    pin.textContent = '\u{1F3C1}';
    el.appendChild(pin);

    const popup = new maplibregl.Popup({ offset: 18, closeButton: false });
    const popupBody = document.createElement('div');
    const name = document.createElement('strong');
    name.className = 'block text-[13px]';
    name.textContent = route.destinationName; // textContent, not setHTML
    const sub = document.createElement('span');
    sub.className = 'text-[11px] opacity-70';
    sub.textContent = 'Destination';
    popupBody.append(name, sub);
    popup.setDOMContent(popupBody);

    destinationMarker.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([route.destinationLng, route.destinationLat])
      .setPopup(popup)
      .addTo(map.current);
  }, [route, ready]);

  // --- markers ------------------------------------------------------------
  useEffect(() => {
    if (!map.current || !ready) return;
    const now = Date.now();

    for (const position of locations) {
      const stale = isStale(position.timestamp, now);
      const isSelf = !!currentUserId && position.ownerId === currentUserId;

      let entry = markers.current.get(position.deviceId);
      if (!entry) {
        const { root, update } = createMarkerElement();
        root.addEventListener('click', () => onSelectDevice?.(position.deviceId));
        const marker = new maplibregl.Marker({ element: root, anchor: 'center' })
          .setLngLat([position.lng, position.lat])
          .addTo(map.current);
        entry = { marker, update };
        markers.current.set(position.deviceId, entry);
      } else {
        // Move the existing marker rather than rebuilding its DOM every tick.
        entry.marker.setLngLat([position.lng, position.lat]);
      }
      entry.update(position, { isSelf, stale });
    }

    for (const [deviceId, entry] of markers.current) {
      if (!locations.some((l) => l.deviceId === deviceId)) {
        entry.marker.remove();
        markers.current.delete(deviceId);
      }
    }
  }, [locations, ready, currentUserId, onSelectDevice]);

  // --- initial framing ----------------------------------------------------
  // Fits once per route (or once when the first positions arrive). The old code refit on
  // every `locations` change, so the camera snapped back every few seconds while panning.
  useEffect(() => {
    if (!map.current || !ready || followDeviceId) return;

    const key = `${route?.id ?? 'no-route'}:${locations.length > 0}`;
    if (hasFitted.current === key) return;

    const points: Array<[number, number]> = locations.map((l) => [l.lng, l.lat]);
    if (route) points.push([route.destinationLng, route.destinationLat]);
    if (points.length === 0) return;

    hasFitted.current = key;
    if (points.length === 1) {
      map.current.easeTo({ center: points[0], zoom: 14, duration: 700 });
    } else {
      const bounds = points.reduce(
        (acc, point) => acc.extend(point),
        new maplibregl.LngLatBounds(points[0], points[0]),
      );
      map.current.fitBounds(bounds, { padding: { top: 80, bottom: 160, left: 60, right: 60 }, maxZoom: 15, duration: 800 });
    }
  }, [locations, route, ready, followDeviceId]);

  // --- explicit recentre --------------------------------------------------
  useEffect(() => {
    if (!map.current || !centerOn) return;
    map.current.easeTo({ center: [centerOn.lng, centerOn.lat], zoom: 16, duration: 800 });
  }, [centerOn]);

  // --- follow mode --------------------------------------------------------
  useEffect(() => {
    if (!map.current || !ready || !followDeviceId) return;
    const target = locations.find((l) => l.deviceId === followDeviceId);
    if (!target) return;
    map.current.easeTo({ center: [target.lng, target.lat], duration: 900 });
  }, [locations, followDeviceId, ready]);

  // --- heading-based rotation --------------------------------------------
  useEffect(() => {
    if (!map.current || !ready) return;

    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!followDeviceId || heading == null || heading < 0 || reduceMotion) {
      if (smoothedBearing.current !== null) {
        smoothedBearing.current = null;
        map.current.easeTo({ bearing: 0, duration: 400 });
      }
      return;
    }

    const followed = locations.find((l) => l.deviceId === followDeviceId);
    // Below walking pace the reported heading is mostly noise.
    if ((followed?.speed ?? 0) * 3.6 < 3) return;

    if (smoothedBearing.current === null) {
      smoothedBearing.current = heading;
    } else {
      let delta = heading - smoothedBearing.current;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      smoothedBearing.current = (smoothedBearing.current + delta * 0.3 + 360) % 360;
    }

    const current = (map.current.getBearing() + 360) % 360;
    const diff = Math.abs(smoothedBearing.current - current);
    if (diff < 5 || diff > 355) return;

    map.current.easeTo({ bearing: smoothedBearing.current, duration: 400 });
  }, [heading, followDeviceId, locations, ready]);

  return <div ref={container} className="h-full w-full" aria-label="Map of trip members" role="application" />;
}
