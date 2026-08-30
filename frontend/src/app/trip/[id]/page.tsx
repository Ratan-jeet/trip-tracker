'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { useWebSocket } from '@/lib/useWebSocket';
import { tripApi } from '@/lib/api';
import MapView, { haversineDistance, formatDistance, formatTime } from '@/components/MapView';
import MemberList from '@/components/MemberList';
import DeviceToggle from '@/components/DeviceToggle';
import HistoryModal from '@/components/HistoryModal';
import SetRouteModal from '@/components/SetRouteModal';
import dayjs from 'dayjs';

export default function TripPage() {
  const router = useRouter();
  const params = useParams();
  const tripId = params.id as string;
  const {
    user, token, currentTrip, liveLocations, isSharing, filter, followDeviceId,
    fetchTrip, fetchMe, toggleSharing, setFilter, setFollowDevice,
  } = useStore();
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [showSetRoute, setShowSetRoute] = useState(false);
  const [centerOn, setCenterOn] = useState<{ lat: number; lng: number } | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance: number; duration: number } | null>(null);
  const [trackingInterval, setTrackingInterval] = useState<NodeJS.Timeout | null>(null);

  useWebSocket(tripId);

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }
    fetchMe().then(() => fetchTrip(tripId)).finally(() => setLoading(false));
  }, [token, tripId, fetchMe, fetchTrip, router]);

  const startTracking = useCallback(async () => {
    if (!navigator.geolocation || !token) return;

    const devices = await import('@/lib/api').then(m => m.deviceApi.list(token, tripId));
    let phoneDevice = devices.find((d: any) => d.deviceType === 'phone' && d.ownerName === user?.displayName);

    if (!phoneDevice) {
      const result = await import('@/lib/api').then(m => m.deviceApi.register(token, {
        tripId,
        deviceType: 'phone',
        name: `${user?.displayName}'s Phone`,
      }));
      phoneDevice = result;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const { latitude: lat, longitude: lng, accuracy, speed, heading } = position.coords;

        let batteryLevel: number | undefined;
        if ('getBattery' in navigator) {
          try {
            const battery = await (navigator as any).getBattery();
            batteryLevel = Math.round(battery.level * 100);
          } catch {}
        }

        try {
          await import('@/lib/api').then(m => m.locationApi.update({
            tripId,
            deviceId: phoneDevice.id,
            lat,
            lng,
            accuracy: accuracy || undefined,
            speed: speed || undefined,
            heading: heading || undefined,
            batteryLevel,
            timestamp: new Date().toISOString(),
          }));
        } catch (err) {
          console.error('Location update failed:', err);
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      }
    );

    setTrackingInterval(watchId as unknown as NodeJS.Timeout);
  }, [token, tripId, user]);

  // Auto-start tracking when trip loads and user is sharing, or when route is set
  useEffect(() => {
    if (currentTrip && isSharing && !trackingInterval) {
      startTracking();
    }
    return () => {
      if (trackingInterval) {
        navigator.geolocation.clearWatch(trackingInterval as unknown as number);
      }
    };
  }, [currentTrip, isSharing, currentTrip?.route]);

  const handleEndTrip = async () => {
    if (!confirm('End this trip? All members will stop sharing location.')) return;
    try {
      await tripApi.endTrip(token!, tripId);
      await fetchTrip(tripId);
    } catch (err: any) {
      alert(err.message || 'Failed to end trip');
    }
  };

  const handleDeleteRoute = async () => {
    if (!confirm('Remove the route?')) return;
    try {
      await tripApi.deleteRoute(token!, tripId);
      await fetchTrip(tripId);
    } catch (err: any) {
      alert(err.message || 'Failed to remove route');
    }
  };

  const handlePromoteMember = async (targetUserId: string, role: string) => {
    try {
      await tripApi.promote(token!, tripId, targetUserId, role);
      await fetchTrip(tripId);
    } catch (err: any) {
      alert(err.message || 'Failed to update role');
    }
  };

  // Fetch OSRM route info when location or route changes
  useEffect(() => {
    if (!currentTrip?.route || liveLocations.length === 0) {
      setRouteInfo(null);
      return;
    }
    const myLoc = liveLocations.find((l: any) =>
      currentTrip.devices.some((d: any) => d.id === l.deviceId && d.ownerName === user?.displayName)
    );
    if (!myLoc) {
      setRouteInfo(null);
      return;
    }
    const controller = new AbortController();
    const fetchRoute = async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${myLoc.lng},${myLoc.lat};${currentTrip.route!.destinationLng},${currentTrip.route!.destinationLat}?overview=false`;
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();
        if (data.code === 'Ok' && data.routes.length > 0) {
          setRouteInfo({ distance: data.routes[0].distance, duration: data.routes[0].duration });
        }
      } catch {}
    };
    fetchRoute();
    return () => controller.abort();
  }, [liveLocations, currentTrip?.route, user?.displayName, currentTrip?.devices]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!currentTrip) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500 mb-4">Trip not found</p>
          <button onClick={() => router.push('/dashboard')} className="text-blue-600 hover:underline">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!currentTrip.isActive) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center bg-white p-8 rounded-2xl shadow-lg max-w-md">
          <div className="text-5xl mb-4">🏁</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Trip Ended</h2>
          <p className="text-gray-500 mb-6">&quot;{currentTrip.name}&quot; has been ended by the admin.</p>
          <button onClick={() => router.push('/dashboard')} className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const isAdmin = currentTrip.memberRole === 'admin';
  const isPrimaryAdmin = currentTrip.creatorId === user?.id;

  const filteredLocations = liveLocations.filter(loc => {
    if (filter === 'phone') return loc.deviceType === 'phone';
    if (filter === 'vehicle') return loc.deviceType === 'vehicle';
    return true;
  });

  return (
    <div className="h-screen flex flex-col bg-white">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-gray-500 hover:text-gray-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="font-bold text-gray-900">{currentTrip.name}</h1>
            <p className="text-xs text-gray-500">
              {currentTrip.members.length} members &middot; Invite: {currentTrip.inviteCode}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <button
                onClick={() => setShowSetRoute(true)}
                className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
              >
                {currentTrip.route ? 'Edit Route' : 'Set Route'}
              </button>
              {currentTrip.route && (
                <button
                  onClick={handleDeleteRoute}
                  className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100"
                >
                  Remove Route
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setShowHistory(true)}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            History
          </button>
          {isPrimaryAdmin && (
            <button
              onClick={handleEndTrip}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
            >
              End Trip
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 relative min-h-[300px]">
          <MapView
            locations={filteredLocations}
            followDeviceId={followDeviceId}
            route={currentTrip.route}
            centerOn={centerOn}
          />
          <div className="absolute top-4 left-4" style={{ zIndex: 1000 }}>
            <DeviceToggle filter={filter} onChange={setFilter} />
          </div>
          <div className="absolute top-4 right-4" style={{ zIndex: 1000 }}>
            <button
              onClick={() => setShowMembers(!showMembers)}
              className="px-3 py-2 bg-white rounded-lg shadow-md text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {currentTrip.members.length}
            </button>
          </div>
          <div className="absolute bottom-4 right-4 flex flex-col gap-2" style={{ zIndex: 1000 }}>
            <button
              onClick={() => {
                const myLoc = liveLocations.find((l: any) =>
                  currentTrip.devices.some((d: any) => d.id === l.deviceId && d.ownerName === user?.displayName)
                );
                if (myLoc) {
                  setCenterOn({ lat: myLoc.lat, lng: myLoc.lng });
                  setFollowDevice(myLoc.deviceId);
                  return;
                }
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      setCenterOn({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                    },
                    () => {},
                    { enableHighAccuracy: true, timeout: 5000 }
                  );
                }
              }}
              className="p-3 bg-white rounded-full shadow-md text-blue-600 hover:bg-blue-50"
              title="My Location"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
          {currentTrip.route && (
            <div className="absolute bottom-4 left-4 right-16" style={{ zIndex: 1000 }}>
              {routeInfo ? (
                <div className="bg-white rounded-xl shadow-lg p-3 flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-600">{formatTime(routeInfo.duration / 3600)}</div>
                    <div className="text-xs text-gray-500">{new Date(Date.now() + routeInfo.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <div className="h-8 w-px bg-gray-200"></div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{formatDistance(routeInfo.distance / 1000)}</div>
                    <div className="text-xs text-gray-500">{currentTrip.route.destinationName}</div>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-lg p-3 flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-400">--</div>
                    <div className="text-xs text-gray-500">ETA</div>
                  </div>
                  <div className="h-8 w-px bg-gray-200"></div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-400">--</div>
                    <div className="text-xs text-gray-500">{currentTrip.route.destinationName}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {showMembers && (
          <div className="shrink-0" style={{ zIndex: 1001 }}>
            <MemberList
              members={currentTrip.members}
              devices={currentTrip.devices}
              liveLocations={filteredLocations}
              followDeviceId={followDeviceId}
              onFollow={setFollowDevice}
              onCenter={(lat, lng) => setCenterOn({ lat, lng })}
              currentUserId={user?.id}
              isPrimaryAdmin={isPrimaryAdmin}
              isAdmin={isAdmin}
              onPromote={handlePromoteMember}
              route={currentTrip.route}
            />
          </div>
        )}
      </div>

      {showHistory && (
        <HistoryModal
          tripId={tripId}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showSetRoute && (
        <SetRouteModal
          tripId={tripId}
          onClose={() => setShowSetRoute(false)}
          onRouteSet={() => fetchTrip(tripId)}
        />
      )}
    </div>
  );
}
