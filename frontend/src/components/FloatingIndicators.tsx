'use client';

import { useEffect, useState, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { haversineDistance, formatDistance } from './MapView';

interface OffScreenMember {
  deviceId: string;
  name: string;
  lat: number;
  lng: number;
  distance: number;
  angle: number;
}

interface FloatingIndicatorsProps {
  mapInstance: maplibregl.Map | null;
  locations: any[];
  currentUserId?: string;
  myDeviceId?: string | null;
  onCenter: (lat: number, lng: number) => void;
}

export default function FloatingIndicators({ mapInstance, locations, currentUserId, myDeviceId, onCenter }: FloatingIndicatorsProps) {
  const [offScreen, setOffScreen] = useState<OffScreenMember[]>([]);

  useEffect(() => {
    if (!mapInstance) return;

    let raf: number | null = null;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const container = mapInstance.getContainer();
        const rect = container.getBoundingClientRect();
        const padding = 36;

        const myLoc = myDeviceId ? locations.find(l => l.deviceId === myDeviceId) : locations[0];
        if (!myLoc || locations.length <= 1) {
          setOffScreen([]);
          return;
        }

        const result: OffScreenMember[] = [];
        for (const loc of locations) {
          if (myDeviceId && loc.deviceId === myDeviceId) continue;
          const point = mapInstance.project([loc.lng, loc.lat]);
          const onScreen = point.x >= padding && point.x <= rect.width - padding && point.y >= padding && point.y <= rect.height - padding;
          if (!onScreen) {
            const dx = point.x - rect.width / 2;
            const dy = point.y - rect.height / 2;
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            const distance = haversineDistance(myLoc.lat, myLoc.lng, loc.lat, loc.lng);
            result.push({ deviceId: loc.deviceId, name: loc.ownerName || loc.deviceName || 'Unknown', lat: loc.lat, lng: loc.lng, distance, angle });
          }
        }
        setOffScreen(result);
      });
    };

    schedule();
    mapInstance.on('move', schedule);
    mapInstance.on('zoom', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      mapInstance.off('move', schedule);
      mapInstance.off('zoom', schedule);
    };
  }, [mapInstance, locations, myDeviceId]);

  if (offScreen.length === 0) return null;

  const unique = new Map<string, OffScreenMember>();
  for (const m of offScreen) {
    const ex = unique.get(m.name);
    if (!ex || m.distance < ex.distance) unique.set(m.name, m);
  }

  const getEdgePosition = (angleDeg: number, rect: DOMRect) => {
    const rad = angleDeg * (Math.PI / 180);
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const pad = 44;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // intersect with rect
    let t = Infinity;
    if (Math.abs(cos) > 0.001) t = Math.min(t, cos > 0 ? (rect.width - pad - cx) / cos : (pad - cx) / cos);
    if (Math.abs(sin) > 0.001) t = Math.min(t, sin > 0 ? (rect.height - pad - cy) / sin : (pad - cy) / sin);
    if (!isFinite(t) || t <= 0) t = Math.min(rect.width, rect.height) / 2 - pad;
    return { x: cx + cos * t, y: cy + sin * t };
  };

  // need rect for positioning — read from map container
  const rect = mapInstance ? mapInstance.getContainer().getBoundingClientRect() : null;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 999 }}>
      {Array.from(unique.values()).map((m) => {
        const pos = rect ? getEdgePosition(m.angle, rect) : { x: 0, y: 0 };
        return (
          <div key={m.deviceId} className="absolute pointer-events-auto cursor-pointer" style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }} onClick={() => onCenter(m.lat, m.lng)}>
            <div className="bg-white/95 backdrop-blur-sm rounded-full shadow-lg border border-gray-200 px-2.5 py-1 flex items-center gap-1.5 hover:bg-blue-50">
              <svg className="w-3.5 h-3.5 text-blue-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} style={{ transform: `rotate(${m.angle}deg)` }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5l7 7-7 7M5 12h14" />
              </svg>
              <span className="text-[11px] font-semibold text-gray-800 whitespace-nowrap">{m.name}</span>
              <span className="text-[10px] text-blue-600 font-medium whitespace-nowrap">{formatDistance(m.distance)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
