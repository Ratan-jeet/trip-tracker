import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { queryOne } from '../db';
import { events, getLivePositions } from '../db/cache';
import { getVisibleDevices } from '../lib/access';

interface TripSocket extends WebSocket {
  tripId?: string;
  userId?: string;
  isAlive?: boolean;
}

const tripConnections = new Map<string, Set<TripSocket>>();

function addConnection(tripId: string, socket: TripSocket): void {
  if (!tripConnections.has(tripId)) tripConnections.set(tripId, new Set());
  tripConnections.get(tripId)!.add(socket);
}

function removeConnection(socket: TripSocket): void {
  if (!socket.tripId) return;
  const set = tripConnections.get(socket.tripId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) tripConnections.delete(socket.tripId);
}

function send(socket: TripSocket, payload: unknown): void {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
}

/**
 * Fan out an event to the sockets watching a trip on this instance. Events reach here
 * both from local publishes and, via Redis pub/sub, from other instances — so a member
 * connected to instance A sees positions written to instance B.
 */
function deliver(tripId: string, event: any): void {
  const sockets = tripConnections.get(tripId);
  if (!sockets || sockets.size === 0) return;

  // Consent revocation and trip teardown close sockets rather than just notifying them.
  if (event?.type === 'access_revoked') {
    for (const socket of [...sockets]) {
      if (socket.userId === event.userId) {
        send(socket, { type: 'access_revoked', tripId });
        socket.close(4003, 'Access revoked');
        removeConnection(socket);
      } else {
        send(socket, event);
      }
    }
    return;
  }

  if (event?.type === 'trip_deleted') {
    for (const socket of [...sockets]) {
      send(socket, event);
      socket.close(4004, 'Trip deleted');
      removeConnection(socket);
    }
    return;
  }

  const message = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === 1) socket.send(message);
  }
}

events.on('trip-event', deliver);

export function setupWebSocket(app: FastifyInstance): void {
  app.get('/ws', { websocket: true }, (socket: TripSocket, _request: FastifyRequest) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    // A socket that never authenticates is dropped rather than left open.
    const authDeadline = setTimeout(() => {
      if (!socket.userId) {
        send(socket, { type: 'auth_error', error: 'Authentication timed out' });
        socket.close(4001, 'Authentication timed out');
      }
    }, 10_000);

    socket.on('message', async (raw) => {
      let message: any;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: 'error', error: 'Invalid message format' });
      }

      try {
        if (message.type === 'auth') {
          let decoded: { userId: string; tv?: number };
          try {
            decoded = app.jwt.verify<{ userId: string; tv?: number }>(message.token);
          } catch {
            send(socket, { type: 'auth_error', error: 'Invalid token' });
            return socket.close(4001, 'Invalid token');
          }

          // Honour the same token_version check the HTTP routes apply, so signing out
          // everywhere also drops live sockets.
          const user = await queryOne<{ token_version: number }>('SELECT token_version FROM users WHERE id = $1', [
            decoded.userId,
          ]);
          if (!user || (decoded.tv ?? 0) !== (user.token_version ?? 0)) {
            send(socket, { type: 'auth_error', error: 'Session expired' });
            return socket.close(4001, 'Session expired');
          }

          socket.userId = decoded.userId;
          clearTimeout(authDeadline);
          return send(socket, { type: 'auth_success' });
        }

        if (!socket.userId) {
          return send(socket, { type: 'error', error: 'Not authenticated' });
        }

        if (message.type === 'subscribe_trip') {
          const tripId = String(message.tripId ?? '');
          const membership = await queryOne('SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2', [
            tripId,
            socket.userId,
          ]);
          if (!membership) return send(socket, { type: 'error', error: 'Not a member of this trip' });

          removeConnection(socket);
          socket.tripId = tripId;
          addConnection(tripId, socket);
          send(socket, { type: 'subscribed', tripId });

          // One query for the whole device roster instead of one per position.
          const visible = await getVisibleDevices(tripId);
          const positions = await getLivePositions(tripId);
          send(socket, {
            type: 'initial_locations',
            locations: positions
              .filter((p) => visible.has(p.deviceId))
              .map((p) => {
                const device = visible.get(p.deviceId)!;
                return {
                  deviceId: p.deviceId,
                  lat: p.lat,
                  lng: p.lng,
                  accuracy: p.accuracy,
                  speed: p.speed,
                  heading: p.heading,
                  batteryLevel: p.batteryLevel,
                  ignitionStatus: p.ignitionStatus,
                  timestamp: p.timestamp,
                  deviceType: device.deviceType,
                  deviceName: device.name,
                  ownerId: device.ownerId,
                  ownerName: device.ownerName,
                };
              }),
          });
          return;
        }

        if (message.type === 'unsubscribe_trip') {
          removeConnection(socket);
          socket.tripId = undefined;
          return send(socket, { type: 'unsubscribed' });
        }

        if (message.type === 'ping') {
          return send(socket, { type: 'pong' });
        }
      } catch (err) {
        app.log.error({ err }, 'websocket message failed');
        send(socket, { type: 'error', error: 'Could not process that message' });
      }
    });

    socket.on('close', () => {
      clearTimeout(authDeadline);
      removeConnection(socket);
    });
  });

  const heartbeat = setInterval(() => {
    app.websocketServer?.clients.forEach((ws) => {
      const socket = ws as TripSocket;
      if (socket.isAlive === false) {
        removeConnection(socket);
        return socket.terminate();
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30_000);
  heartbeat.unref();

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    events.off('trip-event', deliver);
  });
}
