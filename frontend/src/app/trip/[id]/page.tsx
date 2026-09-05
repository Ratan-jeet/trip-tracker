'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, deviceApi, locationApi, tripApi, type ConsentLevel, type RoutingResult } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useWebSocket } from '@/lib/useWebSocket';
import { formatDistance, formatDuration, formatEta, haversineKm } from '@/lib/format';
import ConsentModal from '@/components/ConsentModal';
import DeviceToggle from '@/components/DeviceToggle';
import HistoryModal from '@/components/HistoryModal';
import MapView from '@/components/MapView';
import MemberList from '@/components/MemberList';
import NavigationBanner from '@/components/NavigationBanner';
import SetRouteModal from '@/components/SetRouteModal';
import SharingToggle from '@/components/SharingToggle';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import IconButton from '@/components/ui/IconButton';
import Spinner from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';

/** Refetch the route after this much movement, rather than on every position update. */
const ROUTE_REFRESH_METRES = 150;
const ROUTE_REFRESH_MS = 30_000;

type Confirmation = 'end' | 'leave' | 'purge' | 'removeRoute' | { removeMember: string } | null;

export default function TripPage() {
  const router = useRouter();
  const toast = useToast();
  const tripId = useParams().id as string;

  // Selected slice by slice. `useStore()` with no selector subscribes to the whole store,
  // so this screen re-rendered on every position update and every poll — the map, the
  // member list and every dialog, several times a minute.
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);
  const currentTrip = useStore((s) => s.currentTrip);
  const liveLocations = useStore((s) => s.liveLocations);
  const myDevice = useStore((s) => s.myDevice);
  const filter = useStore((s) => s.filter);
  const followDeviceId = useStore((s) => s.followDeviceId);
  const hydrated = useStore((s) => s.hydrated);
  // Actions are created once by the store factory, so these identities are stable.
  const hydrate = useStore((s) => s.hydrate);
  const fetchTrip = useStore((s) => s.fetchTrip);
  const setSharing = useStore((s) => s.setSharing);
  const setMyDevice = useStore((s) => s.setMyDevice);
  const setFilter = useStore((s) => s.setFilter);
  const setFollowDevice = useStore((s) => s.setFollowDevice);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSetRoute, setShowSetRoute] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [confirming, setConfirming] = useState<Confirmation>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [centerOn, setCenterOn] = useState<{ lat: number; lng: number; nonce: number } | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [routing, setRouting] = useState<RoutingResult | null>(null);
  const [busySharing, setBusySharing] = useState(false);

  const watchId = useRef<number | null>(null);
  const lastRouteFetch = useRef<{ lat: number; lng: number; at: number } | null>(null);
  // Read by the unmount cleanup, which runs after the component's state is gone.
  const consentRef = useRef<ConsentLevel | null>(null);
  const sharingRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  // True while sharing is paused by the tab going to the background, so returning to a
  // visible tab can resume it without asking for consent again.
  const pausedByVisibility = useRef(false);

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const reload = useCallback(async () => {
    try {
      await fetchTrip(tripId);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setNotFound(true);
      else toast.error(err instanceof ApiError ? err.message : 'Could not load the trip');
    }
  }, [fetchTrip, tripId, toast]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    reload().finally(() => setLoading(false));
  }, [hydrated, token, router, reload]);

  useWebSocket(tripId, {
    onMembersChanged: reload,
    onTripEnded: () => {
      toast.show('This trip has ended.');
      void reload();
    },
    onRevoked: () => {
      toast.show('Your location sharing was turned off.');
      void reload();
    },
  });

  // ---- identity -----------------------------------------------------------
  // Matched on ownerId. The old code compared `ownerName === user.displayName`, so two
  // members with the same name would follow — and report into — each other's device.
  const myPosition = useMemo(
    () => (user ? liveLocations.find((l) => l.ownerId === user.id) ?? null : null),
    [liveLocations, user],
  );

  const consentLevel = currentTrip?.consentLevel ?? null;
  consentRef.current = consentLevel;
  tokenRef.current = token;

  const isAdmin = currentTrip?.memberRole === 'admin';
  const isCreator = !!currentTrip && !!user && currentTrip.creatorId === user.id;
  const isSharing = !!currentTrip?.isSharing;
  sharingRef.current = isSharing;

  const visibleLocations = useMemo(
    () => (filter === 'all' ? liveLocations : liveLocations.filter((l) => l.deviceType === filter)),
    [liveLocations, filter],
  );

  // ---- device tracking ----------------------------------------------------
  const stopTracking = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setHeading(null);
  }, []);

  const startTracking = useCallback(async () => {
    if (!token || !user || watchId.current !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('This browser cannot share a location.');
      return;
    }

    let device = myDevice;
    if (!device) {
      const devices = await deviceApi.list(token, tripId);
      device = devices.find((d) => d.deviceType === 'phone' && d.ownerId === user.id) ?? null;
      if (!device) {
        device = await deviceApi.register(token, {
          tripId,
          deviceType: 'phone',
          name: `${user.displayName}'s phone`,
        });
      }
      setMyDevice(device);
    }

    const deviceId = device.id;
    watchId.current = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude, longitude, accuracy, speed, heading: bearing } = position.coords;
        if (bearing != null && !Number.isNaN(bearing)) setHeading(bearing);

        let batteryLevel: number | undefined;
        if ('getBattery' in navigator) {
          try {
            const battery = await (navigator as any).getBattery();
            batteryLevel = Math.round(battery.level * 100);
          } catch {
            /* not supported */
          }
        }

        try {
          // `??` not `||`: a speed or heading of exactly 0 is a real reading.
          await locationApi.update(token, {
            tripId,
            deviceId,
            lat: latitude,
            lng: longitude,
            accuracy: accuracy ?? null,
            speed: speed ?? null,
            heading: bearing ?? null,
            batteryLevel: batteryLevel ?? null,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          // Sharing was revoked elsewhere — stop pushing rather than looping on 403.
          if (err instanceof ApiError && err.status === 403) {
            stopTracking();
            void reload();
          }
        }
      },
      (error) => {
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied. Allow it in your browser settings to share.'
            : 'Could not get a location fix.',
        );
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );
  }, [token, user, myDevice, tripId, setMyDevice, toast, stopTracking, reload]);

  // Tracking follows the consent flag, and always stops on unmount.
  useEffect(() => {
    if (isSharing && currentTrip?.isActive) void startTracking();
    else stopTracking();
    return stopTracking;
  }, [isSharing, currentTrip?.isActive, startTracking, stopTracking]);

  // ---- consent level enforcement -----------------------------------------
  // The three levels were collected, stored and audited, and then all behaved like
  // 'always': nothing ever read consent_level back. These two effects make the wording in
  // the consent dialog true.

  // 'while_using' — sharing pauses when the tab goes to the background and resumes when
  // it comes back, because consent for this session still stands.
  useEffect(() => {
    if (consentLevel !== 'while_using' || !token) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (sharingRef.current) {
          pausedByVisibility.current = true;
          void setSharing(tripId, false).catch(() => undefined);
        }
      } else if (pausedByVisibility.current) {
        pausedByVisibility.current = false;
        void setSharing(tripId, true, 'while_using').catch(() => undefined);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [consentLevel, token, tripId, setSharing]);

  // 'once' and 'while_using' both promise sharing stops when you leave the trip screen.
  // Fire-and-forget: the component is unmounting, so there is nothing left to await into.
  // A tab closed outright never reaches this, which is what the server's idle sweep is
  // for — it clears the flag after SHARING_IDLE_MINUTES of silence.
  useEffect(
    () => () => {
      const level = consentRef.current;
      if (!sharingRef.current || !tokenRef.current) return;
      if (level === 'once' || level === 'while_using') {
        void tripApi.setSharing(tokenRef.current, tripId, false).catch(() => undefined);
      }
    },
    [tripId],
  );

  // ---- routing ------------------------------------------------------------
  useEffect(() => {
    const route = currentTrip?.route;
    if (!token || !route || !myPosition) {
      setRouting(null);
      return;
    }

    const previous = lastRouteFetch.current;
    const movedFar =
      !previous ||
      haversineKm(previous.lat, previous.lng, myPosition.lat, myPosition.lng) * 1000 > ROUTE_REFRESH_METRES;
    const stale = !previous || Date.now() - previous.at > ROUTE_REFRESH_MS;
    if (!movedFar && !stale) return;

    const controller = new AbortController();
    lastRouteFetch.current = { lat: myPosition.lat, lng: myPosition.lng, at: Date.now() };

    locationApi
      .route(
        token,
        tripId,
        { lat: myPosition.lat, lng: myPosition.lng },
        { lat: route.destinationLat, lng: route.destinationLng },
        true,
        controller.signal,
      )
      .then(setRouting)
      .catch(() => undefined);

    return () => controller.abort();
  }, [token, tripId, currentTrip?.route, myPosition]);

  // ---- actions ------------------------------------------------------------
  const toggleSharing = async (level: ConsentLevel) => {
    setBusySharing(true);
    try {
      // Choosing a level again is a fresh grant, so clear any background pause with it.
      pausedByVisibility.current = false;
      await setSharing(tripId, !isSharing, level);
      toast.success(isSharing ? 'Location sharing stopped.' : 'You are now sharing your location.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not change sharing');
    } finally {
      setBusySharing(false);
    }
  };

  const copyInvite = async () => {
    if (!currentTrip) return;
    try {
      await navigator.clipboard.writeText(currentTrip.inviteCode);
      toast.success('Invite code copied.');
    } catch {
      toast.error('Could not copy — select the code and copy it manually.');
    }
  };

  const runAction = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      await reload();
      toast.success(message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'That did not work');
    }
  };

  // ---- render -------------------------------------------------------------
  if (!hydrated || loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="h-8 w-8 text-accent" label="Loading trip" />
      </div>
    );
  }

  if (notFound || !currentTrip) {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-fg">Trip not available</h1>
          <p className="mt-1.5 text-sm text-fg-muted">It may have been deleted, or you are no longer a member.</p>
          <Button className="mt-5" onClick={() => router.push('/dashboard')}>
            Back to your trips
          </Button>
        </div>
      </div>
    );
  }

  const followed = followDeviceId ? liveLocations.find((l) => l.deviceId === followDeviceId) : null;
  const showNav = !!followed && !!currentTrip.route && !!routing?.steps.length;
  const distanceToDestination =
    myPosition && currentTrip.route
      ? haversineKm(myPosition.lat, myPosition.lng, currentTrip.route.destinationLat, currentTrip.route.destinationLng) *
        1000
      : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-base">
      {/* Header */}
      <header className="z-20 flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <IconButton
          label="Back to your trips"
          variant="ghost"
          onClick={() => router.push('/dashboard')}
          icon={
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          }
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-fg">{currentTrip.name}</h1>
            {!currentTrip.isActive && <Badge tone="neutral">Ended</Badge>}
          </div>
          <p className="truncate text-xs text-fg-muted">
            {currentTrip.members.length} {currentTrip.members.length === 1 ? 'member' : 'members'} ·{' '}
            {currentTrip.members.filter((m) => m.isSharing).length} sharing
          </p>
        </div>

        <button
          type="button"
          onClick={copyInvite}
          className="hidden items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-inset hover:text-fg sm:flex"
          title="Copy the invite code"
        >
          <span className="tabular tracking-wider">{currentTrip.inviteCode}</span>
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className="relative">
          <IconButton
            label="Trip options"
            variant="ghost"
            aria-expanded={showMenu}
            onClick={() => setShowMenu((v) => !v)}
            icon={
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            }
          />
          {showMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} aria-hidden="true" />
              <div className="absolute right-0 z-40 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
                {[
                  { label: 'Trip history', onClick: () => setShowHistory(true), show: true },
                  { label: 'Copy invite code', onClick: copyInvite, show: true },
                  {
                    label: currentTrip.route ? 'Change destination' : 'Set destination',
                    onClick: () => setShowSetRoute(true),
                    show: isAdmin && currentTrip.isActive,
                  },
                  {
                    label: 'Remove destination',
                    onClick: () => setConfirming('removeRoute'),
                    show: isAdmin && !!currentTrip.route,
                  },
                  {
                    label: 'New invite code',
                    onClick: () =>
                      runAction(() => tripApi.rotateInviteCode(token!, tripId), 'Invite code replaced.'),
                    show: isAdmin,
                  },
                ]
                  .filter((item) => item.show)
                  .map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="block w-full px-4 py-2.5 text-left text-[13px] text-fg hover:bg-surface-inset"
                      onClick={() => {
                        setShowMenu(false);
                        item.onClick();
                      }}
                    >
                      {item.label}
                    </button>
                  ))}

                <div className="border-t border-border">
                  <button
                    type="button"
                    className="block w-full px-4 py-2.5 text-left text-[13px] text-danger hover:bg-danger-soft"
                    onClick={() => {
                      setShowMenu(false);
                      setConfirming('purge');
                    }}
                  >
                    Delete my location data
                  </button>
                  {isCreator ? (
                    currentTrip.isActive && (
                      <button
                        type="button"
                        className="block w-full px-4 py-2.5 text-left text-[13px] text-danger hover:bg-danger-soft"
                        onClick={() => {
                          setShowMenu(false);
                          setConfirming('end');
                        }}
                      >
                        End trip for everyone
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      className="block w-full px-4 py-2.5 text-left text-[13px] text-danger hover:bg-danger-soft"
                      onClick={() => {
                        setShowMenu(false);
                        setConfirming('leave');
                      }}
                    >
                      Leave trip
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Map */}
      <div className="relative min-h-0 flex-1">
        <MapView
          locations={visibleLocations}
          followDeviceId={followDeviceId}
          route={currentTrip.route}
          routeGeometry={routing?.geometry ?? []}
          centerOn={centerOn}
          heading={heading}
          currentUserId={user?.id}
          onSelectDevice={(deviceId) => setFollowDevice(followDeviceId === deviceId ? null : deviceId)}
        />

        {showNav && followed && (
          <NavigationBanner
            steps={routing!.steps}
            distance={routing!.distance}
            duration={routing!.duration}
            destinationName={currentTrip.route!.destinationName}
            userLat={followed.lat}
            userLng={followed.lng}
          />
        )}

        <div className="absolute left-3 top-3 z-[500]">
          <DeviceToggle filter={filter} onChange={setFilter} />
        </div>

        {followDeviceId && (
          <div className="absolute inset-x-0 bottom-3 z-[500] flex justify-center px-3">
            <Button size="sm" variant="secondary" onClick={() => setFollowDevice(null)} className="shadow-lg">
              Stop following
            </Button>
          </div>
        )}

        <div className="absolute bottom-3 right-3 z-[500]">
          <IconButton
            label="Centre on my location"
            size="lg"
            onClick={() => {
              if (myPosition) {
                setCenterOn({ lat: myPosition.lat, lng: myPosition.lng, nonce: Date.now() });
                return;
              }
              navigator.geolocation?.getCurrentPosition(
                (pos) => setCenterOn({ lat: pos.coords.latitude, lng: pos.coords.longitude, nonce: Date.now() }),
                () => toast.error('Could not get your location.'),
                { enableHighAccuracy: true, timeout: 10_000 },
              );
            }}
            icon={
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="2" />
                <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          />
        </div>

        {currentTrip.route && !showNav && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-[400] flex justify-center">
            <div className="pointer-events-auto flex items-center gap-4 rounded-2xl border border-border bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur">
              <div>
                <p className="tabular text-sm font-semibold text-fg">
                  {routing?.available ? formatDuration(routing.duration) : '—'}
                </p>
                <p className="text-[11px] text-fg-muted">
                  {routing?.available ? `arrive ${formatEta(routing.duration)}` : 'ETA'}
                </p>
              </div>
              <div className="h-8 w-px bg-border" aria-hidden="true" />
              <div className="min-w-0">
                <p className="tabular text-sm font-semibold text-fg">
                  {formatDistance(routing?.distance ?? distanceToDestination)}
                </p>
                <p className="max-w-[9rem] truncate text-[11px] text-fg-muted">
                  {currentTrip.route.destinationName}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom sheet */}
      <div
        className={cn(
          'z-20 shrink-0 border-t border-border bg-surface transition-[max-height] duration-200',
          sheetOpen ? 'max-h-[45dvh]' : 'max-h-[136px]',
        )}
      >
        <div className="flex flex-col">
          {currentTrip.isActive ? (
            <div className="px-4 pt-3">
              <SharingToggle
                isSharing={isSharing}
                disabled={busySharing}
                onToggle={() => setShowConsent(true)}
              />
            </div>
          ) : (
            <p className="px-4 pt-3 text-[13px] text-fg-muted">
              This trip has ended. Location sharing is off for everyone.
            </p>
          )}

          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            aria-expanded={sheetOpen}
            className="mt-2 flex items-center justify-between px-4 py-2 text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              Members &amp; devices
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className={cn('h-4 w-4 text-fg-subtle transition-transform', sheetOpen && 'rotate-180')}
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {sheetOpen && (
            <div className="min-h-0 flex-1 overflow-y-auto pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <MemberList
                members={currentTrip.members}
                devices={currentTrip.devices}
                liveLocations={liveLocations}
                route={currentTrip.route}
                currentUserId={user?.id}
                followDeviceId={followDeviceId}
                isAdmin={!!isAdmin}
                isCreator={isCreator}
                creatorId={currentTrip.creatorId}
                onFollow={setFollowDevice}
                onCenter={(lat, lng) => setCenterOn({ lat, lng, nonce: Date.now() })}
                onPromote={(userId, role) =>
                  runAction(() => tripApi.promote(token!, tripId, userId, role), 'Role updated.')
                }
                onRemove={(userId) => setConfirming({ removeMember: userId })}
              />
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      {showConsent && (
        <ConsentModal
          tripName={currentTrip.name}
          isSharing={isSharing}
          onConfirm={toggleSharing}
          onClose={() => setShowConsent(false)}
        />
      )}

      {showHistory && <HistoryModal tripId={tripId} onClose={() => setShowHistory(false)} />}

      {showSetRoute && (
        <SetRouteModal tripId={tripId} onClose={() => setShowSetRoute(false)} onRouteSet={reload} />
      )}

      {confirming === 'end' && (
        <ConfirmDialog
          title="End this trip?"
          description="Everyone stops sharing immediately and the trip becomes read-only. Recorded history is kept."
          confirmLabel="End trip"
          onClose={() => setConfirming(null)}
          onConfirm={() => runAction(() => tripApi.endTrip(token!, tripId), 'Trip ended.')}
        />
      )}

      {confirming === 'leave' && (
        <ConfirmDialog
          title="Leave this trip?"
          description="You will stop sharing and lose access to the map. You can rejoin with a new invite code."
          confirmLabel="Leave trip"
          onClose={() => setConfirming(null)}
          onConfirm={async () => {
            await tripApi.leave(token!, tripId);
            router.replace('/dashboard');
          }}
        />
      )}

      {confirming === 'purge' && (
        <ConfirmDialog
          title="Delete your location data?"
          description="Every position you have recorded on this trip is permanently erased. This cannot be undone."
          confirmLabel="Delete my data"
          onClose={() => setConfirming(null)}
          onConfirm={() => runAction(() => tripApi.purgeMyData(token!, tripId), 'Your location data was deleted.')}
        />
      )}

      {confirming === 'removeRoute' && (
        <ConfirmDialog
          title="Remove the destination?"
          description="The route disappears for everyone on the trip."
          confirmLabel="Remove"
          onClose={() => setConfirming(null)}
          onConfirm={() => runAction(() => tripApi.deleteRoute(token!, tripId), 'Destination removed.')}
        />
      )}

      {confirming && typeof confirming === 'object' && (
        <ConfirmDialog
          title="Remove this member?"
          description="They lose access straight away, and the invite code is replaced so they cannot rejoin with it."
          confirmLabel="Remove member"
          onClose={() => setConfirming(null)}
          onConfirm={() =>
            runAction(
              () => tripApi.removeMember(token!, tripId, confirming.removeMember),
              'Member removed and invite code replaced.',
            )
          }
        />
      )}
    </div>
  );
}
