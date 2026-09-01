'use client';

import { useEffect, useRef, useState } from 'react';

interface NavStep {
  type: string;
  modifier?: string;
  name: string;
  distance: number;
  duration: number;
  instruction: string;
  coordinates: [number, number][];
}

interface NavigationBannerProps {
  steps: NavStep[];
  userLat: number;
  userLng: number;
  totalDistance: number;
  totalDuration: number;
  destinationName: string;
  visible: boolean;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getManeuverIcon(type: string, modifier?: string): string {
  if (type === 'depart') return '📍';
  if (type === 'arrive') return '🏁';
  if (type === 'roundabout') return '🔄';
  if (type === 'merge') return '⤵️';
  if (type === 'fork') return '🔱';
  if (type === 'end of road') {
    if (modifier === 'right') return '↱';
    if (modifier === 'left') return '↰';
    return '⤴️';
  }
  // turns
  if (modifier === 'left' || modifier === 'slight left' || modifier === 'sharp left') return '↰';
  if (modifier === 'right' || modifier === 'slight right' || modifier === 'sharp right') return '↱';
  if (modifier === 'uturn') return '↩️';
  return '↑';
}

function getManeuverLabel(type: string, modifier?: string): string {
  if (type === 'depart') return 'Head';
  if (type === 'arrive') return 'Arrive at';
  if (type === 'roundabout') return 'Enter roundabout';
  if (type === 'merge') return 'Merge';
  if (type === 'fork') return 'Keep';
  if (type === 'end of road') return 'At end of road';
  if (modifier === 'uturn') return 'Make a U-turn';
  if (modifier === 'sharp left') return 'Sharp left';
  if (modifier === 'sharp right') return 'Sharp right';
  if (modifier === 'slight left') return 'Slight left';
  if (modifier === 'slight right') return 'Slight right';
  if (modifier === 'left') return 'Turn left';
  if (modifier === 'right') return 'Turn right';
  if (modifier === 'straight') return 'Continue straight';
  return 'Continue';
}

function formatDist(meters: number): string {
  if (meters < 100) return `${Math.round(meters)}m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDur(seconds: number): string {
  if (seconds < 60) return '<1 min';
  return `${Math.round(seconds / 60)} min`;
}

export default function NavigationBanner({ steps, userLat, userLng, totalDistance, totalDuration, destinationName, visible }: NavigationBannerProps) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [distToStep, setDistToStep] = useState(0);
  const prevStepIdx = useRef(0);

  // Find which step the user is closest to
  useEffect(() => {
    if (!steps || steps.length === 0 || !visible) return;

    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      // Check distance to the start of this step
      if (step.coordinates && step.coordinates.length > 0) {
        const startCoord = step.coordinates[0];
        const d = haversineDistance(userLat, userLng, startCoord[1], startCoord[0]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
        // Also check end of step
        const endCoord = step.coordinates[step.coordinates.length - 1];
        const dEnd = haversineDistance(userLat, userLng, endCoord[1], endCoord[0]);
        if (dEnd < bestDist) {
          bestDist = dEnd;
          bestIdx = Math.min(i + 1, steps.length - 1);
        }
      }
    }

    // Advance if user passed the step (within 50m of start and moving forward)
    if (bestIdx <= prevStepIdx.current && bestDist < 50 && bestIdx < steps.length - 1) {
      bestIdx = prevStepIdx.current + 1;
    }

    prevStepIdx.current = bestIdx;
    setCurrentStepIdx(bestIdx);

    // Distance remaining to next maneuver point
    if (steps[bestIdx]?.coordinates?.length > 0) {
      const target = steps[bestIdx].coordinates[steps[bestIdx].coordinates.length - 1];
      setDistToStep(haversineDistance(userLat, userLng, target[1], target[0]));
    }
  }, [userLat, userLng, steps, visible]);

  if (!visible || !steps || steps.length === 0) return null;

  const step = steps[currentStepIdx];
  if (!step) return null;

  const isArriving = step.type === 'arrive';
  const icon = getManeuverIcon(step.type, step.modifier);
  const label = getManeuverLabel(step.type, step.modifier);
  const roadName = step.name || '';
  const remaining = totalDistance - steps.slice(0, currentStepIdx).reduce((sum, s) => sum + s.distance, 0);

  return (
    <div className="absolute top-0 left-0 right-0" style={{ zIndex: 998 }}>
      {/* Main instruction */}
      <div className="mx-4 mt-2 bg-gray-900/90 backdrop-blur-sm text-white rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="text-3xl shrink-0 w-10 text-center">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold leading-tight">
              {label}
              {distToStep > 5 && (
                <span className="ml-2 text-blue-300">{formatDist(distToStep)}</span>
              )}
            </div>
            {roadName && (
              <div className="text-sm text-gray-300 truncate">onto {roadName}</div>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-700">
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${Math.max(5, Math.min(100, (1 - remaining / totalDistance) * 100))}%` }}
          />
        </div>

        {/* Bottom info */}
        <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-400">
          <span>{formatDist(remaining)} remaining</span>
          <span>{formatDur(totalDuration)} to {destinationName}</span>
        </div>
      </div>
    </div>
  );
}

export type { NavStep };
