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
  destinationLat: number;
  destinationLng: number;
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

export default function NavigationBanner({
  steps, userLat, userLng, totalDistance, totalDuration,
  destinationName, destinationLat, destinationLng, visible
}: NavigationBannerProps) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [distToStep, setDistToStep] = useState(0);
  const [remainingDist, setRemainingDist] = useState(totalDistance);
  const lastAdvanceTime = useRef(Date.now());
  const prevStepIdx = useRef(0);

  // Calculate actual remaining distance to destination
  useEffect(() => {
    if (!visible) return;
    const dist = haversineDistance(userLat, userLng, destinationLat, destinationLng) * 1000; // convert to meters
    setRemainingDist(dist);
  }, [userLat, userLng, destinationLat, destinationLng, visible]);

  // Find which step user is on — based on proximity to step path
  useEffect(() => {
    if (!steps || steps.length === 0 || !visible) return;

    let bestStepIdx = 0;
    let bestDistToPath = Infinity;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.coordinates || step.coordinates.length === 0) continue;

      // Find closest point on this step's path
      let minDist = Infinity;
      for (const coord of step.coordinates) {
        const d = haversineDistance(userLat, userLng, coord[1], coord[0]);
        if (d < minDist) minDist = d;
      }

      if (minDist < bestDistToPath) {
        bestDistToPath = minDist;
        bestStepIdx = i;
      }
    }

    // Distance to the END of this step (maneuver point)
    const step = steps[bestStepIdx];
    let distToEnd = Infinity;
    if (step?.coordinates?.length > 0) {
      const endCoord = step.coordinates[step.coordinates.length - 1];
      distToEnd = haversineDistance(userLat, userLng, endCoord[1], endCoord[0]) * 1000;
    }

    // Advance to next step only if:
    // 1. User is within 20m of the maneuver point
    // 2. At least 5 seconds since last advance
    // 3. There is a next step
    const now = Date.now();
    if (bestStepIdx >= prevStepIdx.current &&
        distToEnd < 20 &&
        now - lastAdvanceTime.current > 5000 &&
        bestStepIdx < steps.length - 1) {
      bestStepIdx = prevStepIdx.current + 1;
      lastAdvanceTime.current = now;
    }

    prevStepIdx.current = bestStepIdx;
    setCurrentStepIdx(bestStepIdx);

    // Distance to next maneuver
    const nextStep = steps[bestStepIdx];
    if (nextStep?.coordinates?.length > 0) {
      const endCoord = nextStep.coordinates[nextStep.coordinates.length - 1];
      setDistToStep(haversineDistance(userLat, userLng, endCoord[1], endCoord[0]) * 1000);
    }
  }, [userLat, userLng, steps, visible]);

  if (!visible || !steps || steps.length === 0) return null;

  const step = steps[currentStepIdx];
  if (!step) return null;

  const icon = getManeuverIcon(step.type, step.modifier);
  const label = getManeuverLabel(step.type, step.modifier);
  const roadName = step.name || '';

  // Progress based on actual distance traveled
  const progress = totalDistance > 0
    ? Math.max(0, Math.min(100, ((totalDistance - remainingDist) / totalDistance) * 100))
    : 0;

  // Estimate remaining duration based on progress
  const estRemainingDur = totalDuration * (1 - progress / 100);

  return (
    <div className="absolute left-0 right-0" style={{ zIndex: 997, top: '120px' }}>
      <div className="mx-4 bg-gray-900/90 backdrop-blur-sm text-white rounded-xl shadow-2xl overflow-hidden">
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

        <div className="h-1 bg-gray-700">
          <div
            className="h-full bg-blue-500 transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-400">
          <span>{formatDist(remainingDist)} remaining</span>
          <span>{formatDur(estRemainingDur)} to {destinationName}</span>
        </div>
      </div>
    </div>
  );
}

export type { NavStep };
