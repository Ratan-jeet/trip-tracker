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

function getTurnArrow(type: string, modifier?: string): { rotation: number; label: string } {
  if (type === 'depart') return { rotation: 0, label: 'Start' };
  if (type === 'arrive') return { rotation: 0, label: 'Arrive' };
  if (type === 'roundabout') return { rotation: 0, label: 'Roundabout' };

  switch (modifier) {
    case 'uturn': return { rotation: 180, label: 'U-turn' };
    case 'sharp left': return { rotation: -45, label: 'Sharp left' };
    case 'left': return { rotation: -90, label: 'Left' };
    case 'slight left': return { rotation: -135, label: 'Slight left' };
    case 'straight': return { rotation: 0, label: 'Straight' };
    case 'slight right': return { rotation: 135, label: 'Slight right' };
    case 'right': return { rotation: 90, label: 'Right' };
    case 'sharp right': return { rotation: 45, label: 'Sharp right' };
    default: return { rotation: 0, label: 'Continue' };
  }
}

function formatDist(meters: number): string {
  if (meters < 100) return `${Math.round(meters)}m`;
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

function formatDur(seconds: number): string {
  if (seconds < 60) return '<1m';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export default function NavigationBanner({
  steps, userLat, userLng, totalDistance, totalDuration,
  destinationName, destinationLat, destinationLng, visible
}: NavigationBannerProps) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [distToStep, setDistToStep] = useState(0);
  const [remainingDist, setRemainingDist] = useState(totalDistance);
  const [minimized, setMinimized] = useState(false);
  const lastAdvanceTime = useRef(Date.now());
  const prevStepIdx = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const dist = haversineDistance(userLat, userLng, destinationLat, destinationLng) * 1000;
    setRemainingDist(dist);
  }, [userLat, userLng, destinationLat, destinationLng, visible]);

  useEffect(() => {
    if (!steps || steps.length === 0 || !visible) return;

    let bestStepIdx = 0;
    let bestDistToPath = Infinity;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.coordinates || step.coordinates.length === 0) continue;

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

    const step = steps[bestStepIdx];
    let distToEnd = Infinity;
    if (step?.coordinates?.length > 0) {
      const endCoord = step.coordinates[step.coordinates.length - 1];
      distToEnd = haversineDistance(userLat, userLng, endCoord[1], endCoord[0]) * 1000;
    }

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

    const nextStep = steps[bestStepIdx];
    if (nextStep?.coordinates?.length > 0) {
      const endCoord = nextStep.coordinates[nextStep.coordinates.length - 1];
      setDistToStep(haversineDistance(userLat, userLng, endCoord[1], endCoord[0]) * 1000);
    }
  }, [userLat, userLng, steps, visible]);

  if (!visible || !steps || steps.length === 0) return null;

  const step = steps[currentStepIdx];
  if (!step) return null;

  const { rotation, label: arrowLabel } = getTurnArrow(step.type, step.modifier);
  const roadName = step.name || '';
  const progress = totalDistance > 0
    ? Math.max(0, Math.min(100, ((totalDistance - remainingDist) / totalDistance) * 100))
    : 0;
  const estRemainingDur = totalDuration * (1 - progress / 100);

  // Minimized view — small pill
  if (minimized) {
    return (
      <div
        className="absolute left-4 right-4 bottom-20"
        style={{ zIndex: 997 }}
      >
        <button
          onClick={() => setMinimized(false)}
          className="w-full bg-gray-900/70 backdrop-blur-md text-white rounded-full px-4 py-2 flex items-center justify-between shadow-lg hover:bg-gray-900/80 transition-colors"
        >
          <div className="flex items-center gap-2">
            <TurnArrow rotation={rotation} />
            <span className="text-sm font-medium">{formatDist(distToStep)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-300">
            <span>{formatDist(remainingDist)}</span>
            <span>•</span>
            <span>{formatDur(estRemainingDur)}</span>
          </div>
        </button>
      </div>
    );
  }

  // Expanded view — compact card
  return (
    <div
      className="absolute left-4 right-4 bottom-20"
      style={{ zIndex: 997 }}
    >
      <div className="bg-gray-900/75 backdrop-blur-md text-white rounded-2xl shadow-2xl overflow-hidden border border-white/10">
        {/* Top row: arrow + instruction */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="shrink-0">
            <TurnArrow rotation={rotation} size="lg" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-bold leading-tight">
              {arrowLabel}
              {distToStep > 5 && (
                <span className="ml-2 text-blue-300 font-normal">{formatDist(distToStep)}</span>
              )}
            </div>
            {roadName && (
              <div className="text-xs text-gray-400 truncate mt-0.5">onto {roadName}</div>
            )}
          </div>
          <button
            onClick={() => setMinimized(true)}
            className="shrink-0 p-1 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 bg-gray-700/50">
          <div
            className="h-full bg-blue-400/80 transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Bottom row: remaining */}
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs text-gray-400">{formatDist(remainingDist)} left</span>
          <span className="text-xs text-gray-400">{formatDur(estRemainingDur)} • {destinationName}</span>
        </div>
      </div>
    </div>
  );
}

// Turn arrow SVG component
function TurnArrow({ rotation, size = 'md' }: { rotation: number; size?: 'sm' | 'md' | 'lg' }) {
  const sz = size === 'lg' ? 40 : size === 'md' ? 32 : 24;
  return (
    <div
      className="flex items-center justify-center rounded-full bg-blue-500/80"
      style={{ width: sz, height: sz, transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s ease' }}
    >
      <svg
        className="text-white"
        width={sz * 0.5}
        height={sz * 0.5}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </div>
  );
}

export type { NavStep };
