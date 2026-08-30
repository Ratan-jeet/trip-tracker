'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEVICE_COLORS: Record<string, string> = {
  phone: '#3b82f6',
  vehicle: '#ef4444',
};

const DEVICE_ICONS: Record<string, string> = {
  phone: '📱',
  vehicle: '🚗',
};

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
  if (hours < 1/60) return 'Arrived';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function createMarkerIcon(deviceType: string, isStale: boolean, batteryLevel?: number, ownerName?: string, speed?: number, heading?: number) {
  const color = isStale ? '#6b7280' : (DEVICE_COLORS[deviceType] || '#6b7280');
  const emoji = DEVICE_ICONS[deviceType] || '📍';
  const label = ownerName || 'Unknown';
  const speedText = speed ? `${(speed * 3.6).toFixed(0)} km/h` : '';
  const rotation = heading != null ? `transform: rotate(${heading}deg);` : '';

  const html = `
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

  return L.divIcon({
    html,
    className: '',
    iconSize: [40, 56],
    iconAnchor: [20, 48],
  });
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
}

export default function MapView({ locations, followDeviceId, route, centerOn }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<Map<string, L.Marker>>(new Map());
  const routeLine = useRef<L.Polyline | null>(null);
  const memberLines = useRef<L.Polyline[]>([]);
  const destinationMarker = useRef<L.Marker | null>(null);
  const initialized = useRef(false);
  const hasFitted = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapContainer.current || initialized.current) return;
    initialized.current = true;

    map.current = L.map(mapContainer.current, {
      center: [22.5937, 78.9629],
      zoom: 5,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map.current);

    setTimeout(() => {
      map.current?.invalidateSize();
      setMapReady(true);
    }, 100);

    return () => {
      map.current?.remove();
      map.current = null;
      initialized.current = false;
    };
  }, []);

  // Draw route
  useEffect(() => {
    if (!map.current) return;

    if (routeLine.current) {
      map.current.removeLayer(routeLine.current);
      routeLine.current = null;
    }
    if (destinationMarker.current) {
      map.current.removeLayer(destinationMarker.current);
      destinationMarker.current = null;
    }
    memberLines.current.forEach(l => map.current?.removeLayer(l));
    memberLines.current = [];

    if (!route) return;

    const destIcon = L.divIcon({
      html: `<div style="font-size:28px;text-shadow:0 2px 4px rgba(0,0,0,0.3);">🏁</div>`,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    destinationMarker.current = L.marker([route.destinationLat, route.destinationLng], { icon: destIcon })
      .addTo(map.current)
      .bindPopup(`<div style="font-weight:bold;">${route.destinationName}</div>Destination`);

    const routePoints: L.LatLngExpression[] = [];
    if (route.waypoints && route.waypoints.length > 0) {
      route.waypoints.forEach(wp => routePoints.push([wp.lat, wp.lng]));
    }
    routePoints.push([route.destinationLat, route.destinationLng]);

    if (routePoints.length > 1) {
      routeLine.current = L.polyline(routePoints, {
        color: '#2563eb',
        weight: 4,
        opacity: 0.7,
        dashArray: '10, 8',
      }).addTo(map.current);
    }

    if (!hasFitted.current) {
      const allPts: L.LatLngExpression[] = [...routePoints];
      locations.forEach(l => allPts.push([l.lat, l.lng]));
      if (allPts.length > 0) {
        const bounds = L.latLngBounds(allPts);
        map.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      }
      hasFitted.current = true;
    }
  }, [route, mapReady]);

  // Draw lines from each member to destination
  useEffect(() => {
    if (!map.current || !route) return;

    memberLines.current.forEach(l => map.current?.removeLayer(l));
    memberLines.current = [];

    locations.forEach((loc) => {
      const line = L.polyline(
        [[loc.lat, loc.lng], [route.destinationLat, route.destinationLng]],
        { color: '#2563eb', weight: 2, opacity: 0.4, dashArray: '6, 6' }
      ).addTo(map.current!);
      memberLines.current.push(line);
    });
  }, [locations, route]);

  // Center on specific location
  useEffect(() => {
    if (!map.current || !centerOn) return;
    map.current.setView([centerOn.lat, centerOn.lng], 16, { animate: true });
  }, [centerOn]);

  // Update markers
  useEffect(() => {
    if (!map.current) return;

    // Calculate overlapping offsets
    const namePositions: { name: string; lat: number; lng: number; offset: number }[] = [];
    locations.forEach((loc) => {
      const existing = namePositions.find(p =>
        p.name === loc.ownerName &&
        Math.abs(p.lat - loc.lat) < 0.0005 &&
        Math.abs(p.lng - loc.lng) < 0.0005
      );
      if (existing) {
        existing.offset += 20;
      } else {
        namePositions.push({ name: loc.ownerName || '', lat: loc.lat, lng: loc.lng, offset: 0 });
      }
    });

    locations.forEach((loc) => {
      const { deviceId, lat, lng, deviceType, deviceName, speed, accuracy, timestamp, batteryLevel, ownerName, isStale, heading } = loc;

      if (!markers.current.has(deviceId)) {
        const icon = createMarkerIcon(deviceType, isStale, batteryLevel, ownerName, speed, heading);
        const marker = L.marker([lat, lng], { icon }).addTo(map.current!);

        const popupContent = `
          <div style="min-width:160px;font-family:system-ui,sans-serif;">
            <div style="font-weight:bold;font-size:14px;margin-bottom:4px;">${ownerName || deviceName}</div>
            <div style="font-size:12px;">
              ${speed ? `<div>Speed: ${(speed * 3.6).toFixed(1)} km/h</div>` : ''}
              ${accuracy ? `<div>Accuracy: ${accuracy.toFixed(0)}m</div>` : ''}
              <div style="color:#999;">${new Date(timestamp).toLocaleTimeString()}</div>
            </div>
          </div>
        `;

        marker.bindPopup(popupContent);
        markers.current.set(deviceId, marker);
      } else {
        const marker = markers.current.get(deviceId)!;
        marker.setLatLng([lat, lng]);
        const icon = createMarkerIcon(deviceType, isStale, batteryLevel, ownerName, speed, heading);
        marker.setIcon(icon);
      }
    });

    markers.current.forEach((marker, id) => {
      if (!locations.find((l: any) => l.deviceId === id)) {
        marker.remove();
        markers.current.delete(id);
      }
    });

    if (followDeviceId) {
      const followLoc = locations.find((l: any) => l.deviceId === followDeviceId);
      if (followLoc) {
        map.current!.setView([followLoc.lat, followLoc.lng], 16, { animate: true });
      }
    } else if (locations.length > 0 && !hasFitted.current) {
      hasFitted.current = true;
      const bounds = L.latLngBounds(locations.map((l: any) => [l.lat, l.lng] as [number, number]));
      map.current!.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
  }, [locations, followDeviceId]);

  useEffect(() => {
    const handleResize = () => map.current?.invalidateSize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return <div ref={mapContainer} className="w-full h-full" />;
}

export { haversineDistance, formatDistance, formatTime };
