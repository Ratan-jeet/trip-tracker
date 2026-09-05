'use client';

import { useEffect, useRef } from 'react';
import { useStore } from './store';
import { API_URL, locationApi, normaliseBaseUrl, type LivePosition } from './api';

/**
 * The socket endpoint.
 *
 * Two things were wrong here. The server registers the WebSocket route at `/ws`, but the
 * client connected to the bare origin — so the handshake never matched a route, the
 * socket closed immediately and the reconnect loop ran forever. Live updates have in fact
 * always come from the REST poll; the socket contributed nothing. The path is now always
 * appended.
 *
 * Second, the scheme is derived from the API URL when NEXT_PUBLIC_WS_URL is unset. That
 * is one fewer variable to get wrong at deploy time, and it cannot produce an insecure
 * ws:// socket on an https:// page, which browsers block outright.
 */
function socketUrl(): string {
  const base = process.env.NEXT_PUBLIC_WS_URL
    ? normaliseBaseUrl(process.env.NEXT_PUBLIC_WS_URL, 'ws://localhost:3001')
    : API_URL;
  const withScheme = base.replace(/^http/i, 'ws');
  return /\/ws\/?$/.test(withScheme) ? withScheme.replace(/\/$/, '') : `${withScheme.replace(/\/$/, '')}/ws`;
}

const WS_URL = socketUrl();
const POLL_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

interface Options {
  onRevoked?: () => void;
  onTripEnded?: () => void;
  onMembersChanged?: () => void;
}

/**
 * Live position feed.
 *
 * The previous hook reconnected on every close with no backoff and no cancellation, and
 * its cleanup called `close()` — which fired `onclose` — so navigating away from a trip
 * left a socket reconnecting forever. It also fired `subscribe_trip` on a 200 ms timer
 * rather than waiting for the auth reply, which lost the subscription whenever the
 * server was slow.
 */
export function useWebSocket(tripId: string | null, options: Options = {}) {
  const token = useStore((s) => s.token);
  const replaceLocations = useStore((s) => s.replaceLocations);
  const upsertLocation = useStore((s) => s.upsertLocation);
  const dropDevices = useStore((s) => s.dropDevices);
  const setRoute = useStore((s) => s.setRoute);

  // Held in a ref so reconnects never re-run the effect and tear down the socket.
  const handlers = useRef(options);
  handlers.current = options;

  useEffect(() => {
    if (!token || !tripId) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let attempt = 0;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(WS_URL);

      socket.onopen = () => {
        attempt = 0;
        socket?.send(JSON.stringify({ type: 'auth', token }));
      };

      socket.onmessage = (event) => {
        let message: any;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (message.type) {
          // Subscribe only once the server confirms the token, instead of guessing.
          case 'auth_success':
            socket?.send(JSON.stringify({ type: 'subscribe_trip', tripId }));
            break;
          case 'auth_error':
            cancelled = true;
            socket?.close();
            break;
          case 'initial_locations':
            replaceLocations(message.locations as LivePosition[]);
            break;
          case 'location_update':
            upsertLocation(message as LivePosition);
            break;
          case 'route_update':
            setRoute(message.route ?? null);
            break;
          case 'access_revoked':
            if (Array.isArray(message.deviceIds)) dropDevices(message.deviceIds);
            handlers.current.onRevoked?.();
            break;
          case 'devices_changed':
            if (message.removedDeviceId) dropDevices([message.removedDeviceId]);
            handlers.current.onMembersChanged?.();
            break;
          case 'members_changed':
          case 'invite_code_rotated':
            handlers.current.onMembersChanged?.();
            break;
          case 'trip_ended':
          case 'trip_deleted':
            handlers.current.onTripEnded?.();
            break;
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        // Exponential backoff with jitter, rather than a fixed 3 s hammer.
        attempt += 1;
        const delay = Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
        reconnectTimer = window.setTimeout(connect, delay + Math.random() * 500);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    // REST poll as a safety net for a dropped socket. Much slower than the old 5 s beat
    // now that the socket is reliable, and it no longer ignores an empty response.
    const controller = new AbortController();
    const poll = () => {
      locationApi
        .getLive(token, tripId, controller.signal)
        .then(replaceLocations)
        .catch(() => undefined);
    };
    poll();
    const pollTimer = window.setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pollTimer);
      controller.abort();
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
    };
  }, [token, tripId, replaceLocations, upsertLocation, dropDevices, setRoute]);
}
