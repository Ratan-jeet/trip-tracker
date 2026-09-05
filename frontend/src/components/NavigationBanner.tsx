'use client';

import { useMemo } from 'react';
import type { RoutingResult } from '@/lib/api';
import { formatDistance, formatDuration, formatEta } from '@/lib/format';
import { haversineKm } from '@/lib/format';

interface NavigationBannerProps {
  steps: RoutingResult['steps'];
  distance: number | null;
  duration: number | null;
  destinationName: string;
  userLat: number;
  userLng: number;
}

/** Maps an OSRM manoeuvre to a rotation of a single arrow glyph. */
function arrowFor(type: string, modifier: string | null): { rotation: number; label: string } {
  if (type === 'arrive') return { rotation: 0, label: 'Arrive' };
  if (type === 'depart') return { rotation: 0, label: 'Head off' };
  if (type === 'roundabout' || type === 'rotary') return { rotation: 0, label: 'Roundabout' };

  switch (modifier) {
    case 'left':
      return { rotation: -90, label: 'Turn left' };
    case 'right':
      return { rotation: 90, label: 'Turn right' };
    case 'slight left':
      return { rotation: -40, label: 'Bear left' };
    case 'slight right':
      return { rotation: 40, label: 'Bear right' };
    case 'sharp left':
      return { rotation: -135, label: 'Sharp left' };
    case 'sharp right':
      return { rotation: 135, label: 'Sharp right' };
    case 'uturn':
      return { rotation: 180, label: 'Make a U-turn' };
    default:
      return { rotation: 0, label: 'Continue' };
  }
}

export default function NavigationBanner({
  steps,
  distance,
  duration,
  destinationName,
  userLat,
  userLng,
}: NavigationBannerProps) {
  // Pick the upcoming manoeuvre by proximity rather than assuming step 0, which is why
  // the old banner jumped straight to "arrived" as soon as a route loaded.
  const current = useMemo(() => {
    const withLocation = steps.filter((s) => Array.isArray(s.location));
    if (withLocation.length === 0) return null;

    let best = withLocation[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const step of withLocation) {
      const [lng, lat] = step.location as [number, number];
      const d = haversineKm(userLat, userLng, lat, lng);
      if (d < bestDistance) {
        bestDistance = d;
        best = step;
      }
    }
    return { step: best, metresAway: bestDistance * 1000 };
  }, [steps, userLat, userLng]);

  if (!current) return null;

  const arrow = arrowFor(current.step.type, current.step.modifier);

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex justify-center">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-border bg-surface/95 px-3.5 py-2.5 shadow-lg backdrop-blur">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-fg" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" style={{ transform: `rotate(${arrow.rotation}deg)` }}>
            <path d="M12 20V5M12 5l-6 6M12 5l6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">
            {arrow.label}
            {current.step.name ? <span className="font-normal text-fg-muted"> onto {current.step.name}</span> : null}
          </p>
          <p className="tabular text-xs text-fg-muted">in {formatDistance(current.metresAway)}</p>
        </div>

        <div className="shrink-0 border-l border-border pl-3 text-right">
          <p className="tabular text-sm font-semibold text-fg">{formatDuration(duration)}</p>
          <p className="tabular text-xs text-fg-muted">
            {formatEta(duration)} · {formatDistance(distance)}
          </p>
          <p className="sr-only">Destination: {destinationName}</p>
        </div>
      </div>
    </div>
  );
}
