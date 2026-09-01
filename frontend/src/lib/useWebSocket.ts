'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useStore } from './store';
import { locationApi } from './api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

export function useWebSocket(tripId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const token = useStore(s => s.token);
  const addLiveLocation = useStore(s => s.addLiveLocation);
  const updateLiveLocations = useStore(s => s.updateLiveLocations);
  const setTripRoute = useStore(s => s.setTripRoute);

  // Fetch live locations via REST immediately and poll
  useEffect(() => {
    if (!token || !tripId) return;

    const fetchLive = () => {
      locationApi.getLive(token, tripId).then((locations: any[]) => {
        if (locations.length > 0) {
          updateLiveLocations(locations);
        }
      }).catch(() => {});
    };

    fetchLive();
    const interval = setInterval(fetchLive, 5000);
    return () => clearInterval(interval);
  }, [token, tripId, updateLiveLocations]);

  const connect = useCallback(() => {
    if (!token || !tripId) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'subscribe_trip', tripId }));
      }, 200);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'initial_locations') {
        updateLiveLocations(data.locations);
      }

      if (data.type === 'location_update') {
        addLiveLocation({
          deviceId: data.deviceId,
          lat: data.lat,
          lng: data.lng,
          accuracy: data.accuracy,
          speed: data.speed,
          heading: data.heading,
          batteryLevel: data.batteryLevel,
          ignitionStatus: data.ignitionStatus,
          timestamp: data.timestamp,
          deviceType: data.deviceType || 'phone',
          deviceName: data.deviceName || 'Unknown',
          ownerName: data.ownerName,
          isStale: false,
        });
      }

      if (data.type === 'route_update') {
        setTripRoute(data.route || null);
      }
    };

    ws.onclose = () => {
      setTimeout(() => connect(), 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [token, tripId, addLiveLocation, updateLiveLocations, setTripRoute]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return wsRef;
}
