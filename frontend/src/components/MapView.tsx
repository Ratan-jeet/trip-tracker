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
        ${batteryLevel !== undefined ? `<div style="position:absolute;bottom:-4px;right:-4px;background:white;border-radius:10px;padding:1px 4px;font-size:10px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.2);">${batteryLevel}%</div>` : ''}
      </div>
      <div style="margin-top:2px;background:white;padding:1px 4px;border-radius:4px;font-size:9px;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.2);color:#374151;max-width:80px;overflow:hidden;text-overflow:ellipsis;">${label}</div>
      ${speedText ? `<div style="font-size:8px;color:#6b7280;white-space:nowrap;">${speedText}</div>` : ''}
    </div>
  `;
}

interface MapViewProps {
  locations: any[];
  followDeviceId: string | null;
  route?: { destinationName: string; destinationLat: number; destinationLng: number; waypoints: { lat: number; lng: number }[] } | null;
  centerOn?: { lat: number; lng: number } | null;
  onMapReady?: (map: maplibregl.Map) => void;
}

export default function MapView({ locations, followDeviceId, route, centerOn, onMapReady }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const svgContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const destMarker = useRef<maplibregl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const routeCoordsRef = useRef<[number, number][]>([]);
  const memberCoordsRef = useRef<[number, number][]>([]);

  // Project lnglat to screen pixels
  const projectToScreen = (lng: number, lat: number): { x: number; y: number } | null => {
    if (!map.current) return null;
    const p = map.current.project([lng, lat]);
    return { x: p.x, y: p.y };
  };

  // Render SVG route lines
  const renderLines = () => {
    const svg = svgContainer.current;
    if (!svg) return;
    let svgEl = svg.querySelector('svg');
    if (!svgEl) {
      svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgEl.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
      svg.appendChild(svgEl);
    }

    // Clear old lines
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

    const routeCoords = routeCoordsRef.current;
    const memberCoords = memberCoordsRef.current;

    // Draw route line (dark blue)
    if (routeCoords.length > 1) {
      const points = routeCoords
        .map(c => projectToScreen(c[0], c[1]))
        .filter((p): p is { x: number; y: number } => p !== null);
      if (points.length > 1) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        path.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#1a56db');
        path.setAttribute('stroke-width', '6');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('opacity', '0.9');
        svgEl.appendChild(path);
      }
    }

    // Draw member lines (light blue)
    if (memberCoords.length > 1) {
      const points = memberCoords
        .map(c => projectToScreen(c[0], c[1]))
        .filter((p): p is { x: number; y: number } => p !== null && !isNaN(p.x) && !isNaN(p.y));
      if (points.length > 1) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        path.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' '));
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#60a5fa');
        path.setAttribute('stroke-width', '3');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('opacity', '0.7');
        svgEl.appendChild(path);
      }
    }
  };

  // Initialize map + bind SVG redraw to map events (uses refs so always current)
  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }],
      },
      center: [78.9629, 22.5937], zoom: 5, bearing: 0, pitch: 0,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
    m.on('load', () => { setMapReady(true); onMapReady?.(m); });
    // renderLines reads from refs, so always gets current coords
    m.on('move', renderLines);
    m.on('zoom', renderLines);
    m.on('rotate', renderLines);
    m.on('resize', renderLines);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  // Destination marker + fit
  useEffect(() => {
    if (!map.current || !mapReady) return;
    if (destMarker.current) { destMarker.current.remove(); destMarker.current = null; }
    routeCoordsRef.current = [];
    memberCoordsRef.current = [];
    renderLines();

    if (!route) return;

    const destEl = document.createElement('div');
    destEl.innerHTML = `<div style="font-size:32px;text-shadow:0 2px 4px rgba(0,0,0,0.3);">🏁</div>`;
    destMarker.current = new maplibregl.Marker({ element: destEl })
      .setLngLat([route.destinationLng, route.destinationLat])
      .setPopup(new maplibregl.Popup().setHTML(`<b>${route.destinationName}</b><br>Destination`))
      .addTo(map.current);

    const pts: [number, number][] = [[route.destinationLng, route.destinationLat]];
    locations.forEach(l => pts.push([l.lng, l.lat]));
    if (pts.length > 1) {
      const bounds = pts.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(pts[0], pts[0]));
      map.current.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 800 });
    } else {
      map.current.easeTo({ center: [route.destinationLng, route.destinationLat], zoom: 12, duration: 600 });
    }
  }, [route, mapReady]);

  // Fetch OSRM route line + member lines
  useEffect(() => {
    if (!map.current || !mapReady || !route) return;

    const sLng = locations.length > 0 ? locations[0].lng : map.current.getCenter().lng;
    const sLat = locations.length > 0 ? locations[0].lat : map.current.getCenter().lat;

    // Fetch main route line
    fetch(`https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${route.destinationLng},${route.destinationLat}?overview=full&geometries=geojson`)
      .then(r => r.json())
      .then(data => {
        if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
          routeCoordsRef.current = data.routes[0].geometry.coordinates;
        } else {
          routeCoordsRef.current = [[sLng, sLat], [route.destinationLng, route.destinationLat]];
        }
        renderLines();
      })
      .catch(() => {
        routeCoordsRef.current = [[sLng, sLat], [route.destinationLng, route.destinationLat]];
        renderLines();
      });

    // Fit when locations arrive
    if (locations.length > 0) {
      const pts: [number, number][] = [[route.destinationLng, route.destinationLat]];
      locations.forEach(l => pts.push([l.lng, l.lat]));
      const bounds = pts.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(pts[0], pts[0]));
      map.current.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 800 });
    }
  }, [route, locations, mapReady]);

  // Member lines — debounced
  const memberTimer = useRef<any>(null);
  useEffect(() => {
    if (!map.current || !mapReady || !route || locations.length === 0) return;
    if (memberTimer.current) clearTimeout(memberTimer.current);
    memberTimer.current = setTimeout(async () => {
      const allCoords: [number, number][] = [];
      for (const loc of locations) {
        try {
          const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${loc.lng},${loc.lat};${route.destinationLng},${route.destinationLat}?overview=full&geometries=geojson`);
          const data = await res.json();
          if (data.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
            allCoords.push(...data.routes[0].geometry.coordinates);
            allCoords.push([NaN, NaN]);
          }
        } catch {
          allCoords.push([loc.lng, loc.lat], [route.destinationLng, route.destinationLat], [NaN, NaN]);
        }
      }
      memberCoordsRef.current = allCoords.filter(c => !isNaN(c[0]));
      renderLines();
    }, 2000);
    return () => { if (memberTimer.current) clearTimeout(memberTimer.current); };
  }, [locations, route, mapReady]);

  // Center
  useEffect(() => {
    if (!map.current || !centerOn) return;
    map.current.easeTo({ center: [centerOn.lng, centerOn.lat], zoom: 16, duration: 1000 });
  }, [centerOn]);

  // Markers
  useEffect(() => {
    if (!map.current || !mapReady) return;
    const clusters: { lat: number; lng: number; members: number[] }[] = [];
    locations.forEach((loc, i) => {
      const c = clusters.find(c => Math.abs(c.lat - loc.lat) < 0.0003 && Math.abs(c.lng - loc.lng) < 0.0003);
      if (c) c.members.push(i); else clusters.push({ lat: loc.lat, lng: loc.lng, members: [i] });
    });
    const offsets = new Map<number, number>();
    clusters.forEach(c => { if (c.members.length > 1) c.members.forEach((idx, i) => offsets.set(idx, i * 30)); });

    locations.forEach((loc, idx) => {
      const { deviceId, lat, lng, deviceType, ownerName, speed, batteryLevel, isStale, heading, accuracy, timestamp, deviceName } = loc;
      const offsetLat = lat + ((offsets.get(idx) || 0) * 0.00001);
      const popupHtml = `<div style="min-width:140px;font-family:system-ui;"><div style="font-weight:bold;font-size:13px;margin-bottom:4px;">${ownerName || deviceName}</div><div style="font-size:11px;">${speed ? `<div>Speed: ${(speed * 3.6).toFixed(1)} km/h</div>` : ''}${accuracy ? `<div>Accuracy: ${accuracy.toFixed(0)}m</div>` : ''}<div style="color:#999;">${new Date(timestamp).toLocaleTimeString()}</div></div></div>`;

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
        marker.getElement().innerHTML = createMarkerHtml(deviceType, isStale, batteryLevel, ownerName, speed, heading);
      }
    });
    markers.current.forEach((marker, id) => {
      if (!locations.find((l: any) => l.deviceId === id)) { marker.remove(); markers.current.delete(id); }
    });
    if (followDeviceId) {
      const f = locations.find((l: any) => l.deviceId === followDeviceId);
      if (f && map.current) map.current.easeTo({ center: [f.lng, f.lat], zoom: 16, duration: 1000 });
    }
  }, [locations, followDeviceId, mapReady]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
      <div ref={svgContainer} className="absolute inset-0 pointer-events-none" style={{ zIndex: 400 }} />
    </div>
  );
}

export { haversineDistance, formatDistance, formatTime };
