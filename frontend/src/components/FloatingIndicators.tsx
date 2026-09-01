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
  angle: number; // degrees from center of screen
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapInstance) return;

    const update = () => {
      const container = mapInstance.getContainer();
      const rect = container.getBoundingClientRect();
      const bounds = mapInstance.getBounds();
      const center = mapInstance.getCenter();
      const padding = 40; // px from edge

      const myLoc = locations.find(l => l.deviceId === myDeviceId);
      if (!myLoc) {
        setOffScreen([]);
        return;
      }

      const result: OffScreenMember[] = [];

      for (const loc of locations) {
        if (loc.deviceId === myDeviceId) continue;

        const point = mapInstance.project([loc.lng, loc.lat]);
        const isOnScreen =
          point.x >= padding && point.x <= rect.width - padding &&
          point.y >= padding && point.y <= rect.height - padding;

        if (!isOnScreen) {
          const dx = point.x - rect.width / 2;
          const dy = point.y - rect.height / 2;
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          const distance = haversineDistance(myLoc.lat, myLoc.lng, loc.lat, loc.lng);

          result.push({
            deviceId: loc.deviceId,
            name: loc.ownerName || loc.deviceName || 'Unknown',
            lat: loc.lat,
            lng: loc.lng,
            distance,
            angle,
          });
        }
      }

      setOffScreen(result);
    };

    update();
    mapInstance.on('move', update);
    mapInstance.on('zoom', update);
    mapInstance.on('resize', update);

    return () => {
      mapInstance.off('move', update);
      mapInstance.off('zoom', update);
      mapInstance.off('resize', update);
    };
  }, [mapInstance, locations, currentUserId, myDeviceId]);

  if (offScreen.length === 0) return null;

  // Clamp each indicator to the edge of the screen
  const getEdgePosition = (angleDeg: number) => {
    const angleRad = angleDeg * (Math.PI / 180);
    const w = typeof window !== 'undefined' ? window.innerWidth : 800;
    const h = typeof window !== 'undefined' ? window.innerHeight : 600;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(cx, cy) - 30;

    // Intersect the ray from center with the viewport rectangle
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    let x = cx;
    let y = cy;

    if (Math.abs(cos) > 0.001) {
      const tRight = (w - 30 - cx) / cos;
      const tLeft = (30 - cx) / cos;
      const t = cos > 0 ? tRight : tLeft;
      if (Math.abs(t) < maxR * 3) {
        x = cx + t * cos;
        y = cy + t * sin;
      }
    }

    if (y < 30 || y > h - 30) {
      const t = sin > 0 ? (h - 30 - cy) / sin : (30 - cy) / sin;
      x = cx + t * cos;
      y = cy + t * sin;
    }

    x = Math.max(20, Math.min(w - 20, x));
    y = Math.max(20, Math.min(h - 20, y));

    return { x, y };
  };

  // Deduplicate by name (show closest indicator per person)
  const unique = new Map<string, OffScreenMember>();
  for (const m of offScreen) {
    const existing = unique.get(m.name);
    if (!existing || m.distance < existing.distance) {
      unique.set(m.name, m);
    }
  }

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 999 }}>
      {Array.from(unique.values()).map((m) => {
        const pos = getEdgePosition(m.angle);
        const arrowAngle = m.angle + 180; // arrow points inward

        return (
          <div
            key={m.deviceId}
            className="absolute pointer-events-auto cursor-pointer"
            style={{
              left: pos.x,
              top: pos.y,
              transform: 'translate(-50%, -50%)',
            }}
            onClick={() => onCenter(m.lat, m.lng)}
          >
            <div className="bg-white/95 backdrop-blur-sm rounded-full shadow-lg border border-gray-200 px-2.5 py-1 flex items-center gap-1.5 hover:bg-blue-50 transition-colors">
              <svg
                className="w-3.5 h-3.5 text-blue-600 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                style={{ transform: `rotate(${arrowAngle}deg)` }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
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
