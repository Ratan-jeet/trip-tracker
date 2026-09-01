'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(1)} km`;
}

function formatTime(hours: number): string {
  if (hours < 1 / 60) return 'Arrived';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function createMarkerHtml(deviceType: string, isStale: boolean, batteryLevel?: number, ownerName?: string, speed?: number, heading?: number) {
  const colors: Record<string, string> = { phone: '#3b82f6', vehicle: '#ef4444' };
  const emojis: Record<string, string> = { phone: '📱', vehicle: '🚗' };
  const color = isStale ? '#6b7280' : (colors[deviceType] || '#6b7280');
  const emoji = emojis[deviceType] || '📍';
  const label = ownerName || 'Unknown';
  const speedText = speed ? `${(speed * 3.6).toFixed(0)} km/h` : '';
  const rotation = heading != null ? `transform: rotate(${heading}deg);` : '';

  return `
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;">
      <div style="position:relative;width:40px;height:40px;">
        <div style="position:absolute;inset:-4px;border-radius:50%;background:${color};opacity:0.3;animation:pulse-ring 1.5s infinite;"></div>
        <div style="width:40px;height:40px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,0.3);color:white;border:3px solid white;${rotation}">
          ${emoji}
        </div>
        ${batteryLevel !== undefined ? `
          <div style="position:absolute;bottom:-4px;right:-4px;background:white;border-radius:10px;padding:1px 4px;font-size:10px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.2);">
            ${batteryLevel}%
          </div>
        ` : ''}
      </div>
      <div style="margin-top:2px;background:white;padding:1px 4px;border-radius:4px;font-size:9px;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.2);color:#374151;max-width:80px;overflow:hidden;text-overflow:ellipsis;">
        ${label}
      </div>
      ${speedText ? `<div style="font-size:8px;color:#6b7280;white-space:nowrap;">${speedText}</div>` : ''}
    </div>
  `;
}

interface MapViewProps {
  locations: any[];
  followDeviceId: string | null;
  route?: {
    destinationName: string;
    destinationLat: number;
    destinationLng: number;
    waypoints: { lat: number; lng: number }[];
  } | null;
  centerOn?: { lat: number; lng: number } | null;
  onMapReady?: (map: maplibregl.Map) => void;
}

export default function MapView({ locations, followDeviceId, route, centerOn, onMapReady }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const routeSource = useRef<string>('route-line');
  const memberLinesSource = useRef<string>('member-lines');
  const destMarker = useRef<maplibregl.Marker | null>(null);
  const initialized = useRef(false);
  const locationsFitted = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || initialized.current) return;
    initialized.current = true;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [78.9629, 22.5937],
      zoom: 5,
      bearing: 0,
      pitch: 0,
      maxPitch: 60,
    });

    map.current.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');

    map.current.on('load', () => {
      setMapReady(true);
      if (onMapReady && map.current) onMapReady(map.current);
    });

    return () => {
      map.current?.remove();
      map.current = null;
      initialized.current = false;
    };
  }, []);

  // Enable compass-based rotation (manual only via map controls)

  // Destination marker — only on route change
  useEffect(() => {
    if (!map.current || !mapReady) return;
    if (destMarker.current) {
      destMarker.current.remove();
      destMarker.current = null;
    }
    if (!route) {
      if (map.current.getLayer('route-line')) map.current.removeLayer('route-line');
      if (map.current.getSource('route-line')) map.current.removeSource('route-line');
      if (map.current.getLayer('member-lines')) map.current.removeLayer('member-lines');
      if (map.current.getSource('member-lines')) map.current.removeSource('member-lines');
      return;
    }
    const destEl = document.createElement('div');
    destEl.innerHTML = `<div style="font-size:32px;text-shadow:0 2px 4px rgba(0,0,0,0.3);">🏁</div>`;
    destMarker.current = new maplibregl.Marker({ element: destEl })
      .setLngLat([route.destinationLng, route.destinationLat])
      .setPopup(new maplibregl.Popup().setHTML(`<b>${route.destinationName}</b><br>Destination`))
      .addTo(map.current);
  }, [route, mapReady]);

  // Route line + fit — draws immediately, updates when first location arrives
  const routeFitted = useRef<string | null>(null);
  useEffect(() => {
    if (!map.current || !mapReady || !route) return;
    const routeKey = `${route.destinationLat},${route.destinationLng}`;
    const needsFit = !routeFitted.current || !routeFitted.current.startsWith(routeKey);

    // clean old line
    if (map.current.getLayer('route-line')) map.current.removeLayer('route-line');
    if (map.current.getSource('route-line')) map.current.removeSource('route-line');

    let cancelled = false;
    const start = locations.length > 0 ? locations[0] : null;
    const fetchLine = async () => {
      // if no location yet, show straight dashed line from map center to destination so route is visible immediately
      const s = start || { lng: map.current!.getCenter().lng, lat: map.current!.getCenter().lat };
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${s.lng},${s.lat};${route.destinationLng},${route.destinationLat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled || !map.current || (map.current as any)._removed) return;
        let coords: [number, number][];
        let dashed = false;
        if (data.code === 'Ok' && data.routes.length > 0) {
          coords = data.routes[0].geometry.coordinates as [number, number][];
          dashed = !start; // dashed if we used map center
        } else {
          coords = [[s.lng, s.lat], [route.destinationLng, route.destinationLat]];
          dashed = true;
        }
        if (map.current.getSource('route-line')) return;
        map.current.addSource('route-line', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} },
        });
        map.current.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-line',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#1a56db',
            'line-width': 6,
            'line-opacity': 0.9,
            ...(dashed ? { 'line-dasharray': [4, 4] } as any : {}),
          },
        });
      } catch {
        if (cancelled || !map.current || (map.current as any)._removed) return;
        const coords: [number, number][] = [[s.lng, s.lat], [route.destinationLng, route.destinationLat]];
        if (map.current.getSource('route-line')) return;
        map.current.addSource('route-line', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} },
        });
        map.current.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-line',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#1a56db', 'line-width': 4, 'line-opacity': 0.6, 'line-dasharray': [6, 6] },
        });
      }
    };
    fetchLine();

    if (needsFit) {
      if (locations.length > 0) {
        const allPts: [number, number][] = [[route.destinationLng, route.destinationLat]];
        locations.forEach(l => allPts.push([l.lng, l.lat]));
        const bounds = allPts.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(allPts[0], allPts[0]));
        map.current.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 800 });
        routeFitted.current = `${routeKey}_done`;
      } else {
        map.current.easeTo({ center: [route.destinationLng, route.destinationLat], zoom: 12, duration: 600 });
        routeFitted.current = `${routeKey}_noLoc`;
      }
    } else if (routeFitted.current === `${routeKey}_noLoc` && locations.length > 0) {
      const allPts: [number, number][] = [[route.destinationLng, route.destinationLat]];
      locations.forEach(l => allPts.push([l.lng, l.lat]));
      const bounds = allPts.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(allPts[0], allPts[0]));
      map.current.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 800 });
      routeFitted.current = `${routeKey}_done`;
    }

    return () => { cancelled = true; };
  }, [route, locations, mapReady]);

  // Draw member-to-destination lines via OSRM — debounced, no map movement
  const memberLinesTimer = useRef<any>(null);
  useEffect(() => {
    if (!map.current || !mapReady || !route) return;
    if (memberLinesTimer.current) clearTimeout(memberLinesTimer.current);
    memberLinesTimer.current = setTimeout(async () => {
      if (!map.current || (map.current as any)._removed) return;
      const allCoords: [number, number][] = [];
      for (const loc of locations) {
        try {
          const url = `https://router.project-osrm.org/route/v1/driving/${loc.lng},${loc.lat};${route.destinationLng},${route.destinationLat}?overview=full&geometries=geojson`;
          const res = await fetch(url);
          const data = await res.json();
          if (data.code === 'Ok' && data.routes.length > 0) {
            const coords = data.routes[0].geometry.coordinates as [number, number][];
            allCoords.push(...coords);
            allCoords.push([NaN, NaN]);
          }
        } catch {
          allCoords.push([loc.lng, loc.lat], [route.destinationLng, route.destinationLat], [NaN, NaN]);
        }
      }
      if (!map.current || (map.current as any)._removed) return;
      const filtered = allCoords.filter(c => !isNaN(c[0]));
      const existing = map.current.getSource('member-lines') as maplibregl.GeoJSONSource | undefined;
      if (filtered.length === 0) {
        if (map.current.getLayer('member-lines')) map.current.removeLayer('member-lines');
        if (map.current.getSource('member-lines')) map.current.removeSource('member-lines');
        return;
      }
      const geojson: any = { type: 'Feature', geometry: { type: 'LineString', coordinates: filtered }, properties: {} };
      if (existing) {
        (existing as any).setData(geojson);
      } else {
        map.current.addSource('member-lines', { type: 'geojson', data: geojson });
        map.current.addLayer({
          id: 'member-lines',
          type: 'line',
          source: 'member-lines',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#60a5fa', 'line-width': 3, 'line-opacity': 0.7 },
        });
      }
    }, 1500);
    return () => { if (memberLinesTimer.current) clearTimeout(memberLinesTimer.current); };
  }, [locations, route, mapReady]);

  // Center on location
  useEffect(() => {
    if (!map.current || !centerOn) return;
    map.current.easeTo({ center: [centerOn.lng, centerOn.lat], zoom: 16, duration: 1000 });
  }, [centerOn]);

  // Update markers
  useEffect(() => {
    if (!map.current || !mapReady) return;

    // Cluster nearby markers
    const clusters: { lat: number; lng: number; members: number[] }[] = [];
    locations.forEach((loc, i) => {
      const cluster = clusters.find(c =>
        Math.abs(c.lat - loc.lat) < 0.0003 && Math.abs(c.lng - loc.lng) < 0.0003
      );
      if (cluster) {
        cluster.members.push(i);
      } else {
        clusters.push({ lat: loc.lat, lng: loc.lng, members: [i] });
      }
    });

    const offsets = new Map<number, number>();
    clusters.forEach(cluster => {
      if (cluster.members.length > 1) {
        cluster.members.forEach((idx, i) => offsets.set(idx, i * 30));
      }
    });

    locations.forEach((loc, idx) => {
      const { deviceId, lat, lng, deviceType, ownerName, speed, batteryLevel, isStale, heading, accuracy, timestamp, deviceName } = loc;
      const offsetPx = offsets.get(idx) || 0;
      const offsetLat = lat + (offsetPx * 0.00001);

      const popupHtml = `
        <div style="min-width:140px;font-family:system-ui,sans-serif;">
          <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">${ownerName || deviceName}</div>
          <div style="font-size:11px;">
            ${speed ? `<div>Speed: ${(speed * 3.6).toFixed(1)} km/h</div>` : ''}
            ${accuracy ? `<div>Accuracy: ${accuracy.toFixed(0)}m</div>` : ''}
            <div style="color:#999;">${new Date(timestamp).toLocaleTimeString()}</div>
          </div>
        </div>
      `;

      if (!markers.current.has(deviceId)) {
        const el = document.createElement('div');
        el.innerHTML = createMarkerHtml(deviceType, isStale, batteryLevel, ownerName, speed, heading);
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([lng, offsetLat])
          .setPopup(new maplibregl.Popup().setHTML(popupHtml))
          .addTo(map.current!);
        markers.current.set(deviceId, marker);
      } else {
        const marker = markers.current.get(deviceId)!;
        marker.setLngLat([lng, offsetLat]);
        const el = marker.getElement();
        el.innerHTML = createMarkerHtml(deviceType, isStale, batteryLevel, ownerName, speed, heading);
      }
    });

    // Remove stale markers
    markers.current.forEach((marker, id) => {
      if (!locations.find((l: any) => l.deviceId === id)) {
        marker.remove();
        markers.current.delete(id);
      }
    });

    // Follow device
    if (followDeviceId) {
      const followLoc = locations.find((l: any) => l.deviceId === followDeviceId);
      if (followLoc && map.current) {
        map.current.easeTo({ center: [followLoc.lng, followLoc.lat], zoom: 16, duration: 1000 });
      }
    } else if (locations.length > 0 && !locationsFitted.current) {
      locationsFitted.current = true;
      const bounds = locations.reduce(
        (b, l) => b.extend([l.lng, l.lat]),
        new maplibregl.LngLatBounds([locations[0].lng, locations[0].lat], [locations[0].lng, locations[0].lat])
      );
      map.current?.fitBounds(bounds, { padding: 50, maxZoom: 15 });
    }
  }, [locations, followDeviceId, mapReady]);

  return <div ref={mapContainer} className="w-full h-full" />;
}

export { haversineDistance, formatDistance, formatTime };
