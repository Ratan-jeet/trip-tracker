'use client';

import { useEffect, useRef } from 'react';
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

function createMarkerIcon(deviceType: string, isStale: boolean, batteryLevel?: number) {
  const color = isStale ? '#6b7280' : (DEVICE_COLORS[deviceType] || '#6b7280');
  const emoji = DEVICE_ICONS[deviceType] || '📍';

  const html = `
    <div style="position:relative;width:40px;height:40px;">
      <div style="position:absolute;inset:-4px;border-radius:50%;background:${color};opacity:0.3;animation:pulse-ring 1.5s infinite;"></div>
      <div style="width:40px;height:40px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,0.3);color:white;border:3px solid white;">
        ${emoji}
      </div>
      ${batteryLevel !== undefined ? `
        <div style="position:absolute;bottom:-4px;right:-4px;background:white;border-radius:10px;padding:1px 4px;font-size:10px;font-weight:bold;box-shadow:0 1px 3px rgba(0,0,0,0.2);">
          ${batteryLevel}%
        </div>
      ` : ''}
    </div>
  `;

  return L.divIcon({
    html,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

interface MapViewProps {
  locations: any[];
  followDeviceId: string | null;
}

export default function MapView({ locations, followDeviceId }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<Map<string, L.Marker>>(new Map());
  const initialized = useRef(false);

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
    }, 100);

    return () => {
      map.current?.remove();
      map.current = null;
      initialized.current = false;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;

    locations.forEach((loc) => {
      const { deviceId, lat, lng, deviceType, deviceName, speed, accuracy, timestamp, batteryLevel, ownerName, isStale } = loc;

      if (!markers.current.has(deviceId)) {
        const icon = createMarkerIcon(deviceType, isStale, batteryLevel);
        const marker = L.marker([lat, lng], { icon }).addTo(map.current!);

        const popupContent = `
          <div style="min-width:160px;font-family:system-ui,sans-serif;">
            <div style="font-weight:bold;font-size:14px;margin-bottom:4px;">${deviceName}</div>
            ${ownerName ? `<div style="font-size:12px;color:#666;margin-bottom:4px;">${ownerName}</div>` : ''}
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
        const icon = createMarkerIcon(deviceType, isStale, batteryLevel);
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
    } else if (locations.length > 0) {
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
