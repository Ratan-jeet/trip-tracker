'use client';

import { useEffect, useState } from 'react';
import type { Device, LivePosition, TripMember, TripRoute } from '@/lib/api';
import { formatDistance, formatRelative, formatSpeed, haversineKm, initialsOf, isStale } from '@/lib/format';
import Badge from './ui/Badge';
import IconButton from './ui/IconButton';
import { cn } from './ui/cn';

interface MemberListProps {
  members: TripMember[];
  devices: Device[];
  liveLocations: LivePosition[];
  route: TripRoute | null;
  currentUserId?: string;
  followDeviceId: string | null;
  isAdmin: boolean;
  isCreator: boolean;
  creatorId: string;
  onFollow: (deviceId: string | null) => void;
  onCenter: (lat: number, lng: number) => void;
  onPromote: (userId: string, role: 'admin' | 'member') => void;
  onRemove: (userId: string) => void;
}

export default function MemberList({
  members,
  devices,
  liveLocations,
  route,
  currentUserId,
  followDeviceId,
  isAdmin,
  isCreator,
  creatorId,
  onFollow,
  onCenter,
  onPromote,
  onRemove,
}: MemberListProps) {
  // Staleness is time-dependent, so re-render on a timer instead of freezing whatever
  // the server thought at request time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const [menuFor, setMenuFor] = useState<string | null>(null);

  // Devices are matched to people by owner id. Matching on display name — as this list
  // and the trip page both used to — mixes up any two members with the same name.
  const positionFor = (userId: string) =>
    liveLocations.find((l) => l.ownerId === userId && l.deviceType === 'phone') ??
    liveLocations.find((l) => l.ownerId === userId);

  const vehicles = liveLocations.filter((l) => l.deviceType === 'vehicle');

  return (
    <div className="divide-y divide-border">
      {members.map((member) => {
        const position = positionFor(member.userId);
        const stale = position ? isStale(position.timestamp, now) : true;
        const isSelf = member.userId === currentUserId;
        const distanceToDestination =
          position && route
            ? haversineKm(position.lat, position.lng, route.destinationLat, route.destinationLng) * 1000
            : null;

        return (
          <div key={member.userId} className="flex items-center gap-3 px-4 py-3">
            <span
              className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold',
                member.isSharing && !stale ? 'bg-accent text-accent-fg' : 'bg-surface-inset text-fg-subtle',
              )}
              aria-hidden="true"
            >
              {initialsOf(member.displayName)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-fg">
                  {member.displayName}
                  {isSelf && <span className="ml-1 text-fg-subtle">(you)</span>}
                </span>
                {member.userId === creatorId ? (
                  <Badge tone="accent">Owner</Badge>
                ) : member.role === 'admin' ? (
                  <Badge tone="neutral">Admin</Badge>
                ) : null}
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-muted">
                {!member.isSharing ? (
                  <span className="text-fg-subtle">Not sharing</span>
                ) : !position ? (
                  <span className="text-fg-subtle">Waiting for a fix…</span>
                ) : (
                  <>
                    <span className={cn('flex items-center gap-1', !stale && 'text-live')}>
                      <span
                        className={cn('h-1.5 w-1.5 rounded-full', stale ? 'bg-fg-subtle' : 'bg-live')}
                        aria-hidden="true"
                      />
                      {stale ? formatRelative(position.timestamp, now) : 'Live'}
                    </span>
                    {formatSpeed(position.speed) && <span className="tabular">{formatSpeed(position.speed)}</span>}
                    {distanceToDestination != null && (
                      <span className="tabular">{formatDistance(distanceToDestination)} to go</span>
                    )}
                    {position.batteryLevel != null && (
                      <span className={cn('tabular', position.batteryLevel <= 15 && 'text-warning')}>
                        {position.batteryLevel}%
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {position && (
                <>
                  <IconButton
                    label={`Centre the map on ${member.displayName}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => onCenter(position.lat, position.lng)}
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    }
                  />
                  <IconButton
                    label={
                      followDeviceId === position.deviceId
                        ? `Stop following ${member.displayName}`
                        : `Follow ${member.displayName}`
                    }
                    variant={followDeviceId === position.deviceId ? 'accent' : 'ghost'}
                    size="sm"
                    onClick={() => onFollow(followDeviceId === position.deviceId ? null : position.deviceId)}
                    icon={
                      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                        <path
                          d="M3 11l18-8-8 18-2-8-8-2z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                          fill={followDeviceId === position.deviceId ? 'currentColor' : 'none'}
                        />
                      </svg>
                    }
                  />
                </>
              )}

              {isAdmin && !isSelf && member.userId !== creatorId && (
                <div className="relative">
                  <IconButton
                    label={`Manage ${member.displayName}`}
                    variant="ghost"
                    size="sm"
                    aria-expanded={menuFor === member.userId}
                    onClick={() => setMenuFor(menuFor === member.userId ? null : member.userId)}
                    icon={
                      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                        <circle cx="12" cy="5" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="12" cy="19" r="1.6" />
                      </svg>
                    }
                  />
                  {menuFor === member.userId && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} aria-hidden="true" />
                      <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
                        <button
                          type="button"
                          className="block w-full px-3.5 py-2.5 text-left text-[13px] text-fg hover:bg-surface-inset"
                          onClick={() => {
                            onPromote(member.userId, member.role === 'admin' ? 'member' : 'admin');
                            setMenuFor(null);
                          }}
                        >
                          {member.role === 'admin' ? 'Remove admin' : 'Make admin'}
                        </button>
                        {isCreator && (
                          <button
                            type="button"
                            className="block w-full border-t border-border px-3.5 py-2.5 text-left text-[13px] text-danger hover:bg-danger-soft"
                            onClick={() => {
                              onRemove(member.userId);
                              setMenuFor(null);
                            }}
                          >
                            Remove from trip
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {vehicles.map((vehicle) => {
        const stale = isStale(vehicle.timestamp, now);
        return (
          <div key={vehicle.deviceId} className="flex items-center gap-3 px-4 py-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white"
              style={{ background: 'hsl(var(--vehicle))' }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M5 17h14M6 17v2M18 17v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4 17l1.4-5.2A2 2 0 0 1 7.3 10h9.4a2 2 0 0 1 1.9 1.8L20 17" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-fg">{vehicle.deviceName}</span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                <span className={cn(!stale && 'text-live')}>{stale ? formatRelative(vehicle.timestamp, now) : 'Live'}</span>
                {formatSpeed(vehicle.speed) && <span className="tabular">{formatSpeed(vehicle.speed)}</span>}
                {vehicle.ignitionStatus != null && <span>{vehicle.ignitionStatus ? 'Ignition on' : 'Ignition off'}</span>}
              </span>
            </div>
            <IconButton
              label={`Centre the map on ${vehicle.deviceName}`}
              variant="ghost"
              size="sm"
              onClick={() => onCenter(vehicle.lat, vehicle.lng)}
              icon={
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              }
            />
          </div>
        );
      })}

      {devices.length === 0 && members.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-fg-subtle">No members yet.</p>
      )}
    </div>
  );
}
