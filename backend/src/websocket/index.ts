import { FastifyInstance, FastifyRequest } from 'fastify';
import { WebSocket } from 'ws';
import { queryOne } from '../db/helpers';
import { getLiveLocations } from '../db/cache-wrapper';

interface TripWebSocket extends WebSocket {
  tripId?: string;
  userId?: string;
  isAlive?: boolean;
}

const tripConnections = new Map<string, Set<TripWebSocket>>();

async function getDeviceInfoForLocation(tripId: string, deviceId: string) {
  const device: any = await queryOne(
    `SELECT d.id, d.device_type, d.name, u.display_name as owner_name
     FROM devices d LEFT JOIN users u ON d.user_id = u.id
     WHERE d.id = $1 AND d.trip_id = $2`,
    [deviceId, tripId]
  );
  if (!device) return {};
  return {
    deviceType: device.device_type,
    deviceName: device.name,
    ownerName: device.owner_name,
  };
}

async function enrichLocation(tripId: string, loc: any) {
  const deviceInfo = await getDeviceInfoForLocation(tripId, loc.deviceId);
  return {
    ...loc,
    ...deviceInfo,
    isStale: Date.now() - new Date(loc.timestamp).getTime() > 120000,
  };
}

export function setupWebSocket(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket: TripWebSocket, request: FastifyRequest) => {
    socket.isAlive = true;
    let authenticated = false;

    socket.on('pong', () => { socket.isAlive = true; });

    socket.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'auth') {
          try {
            const decoded = app.jwt.verify<{ userId: string }>(message.token);
            socket.userId = decoded.userId;
            authenticated = true;
            socket.send(JSON.stringify({ type: 'auth_success' }));
          } catch {
            socket.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
            socket.close();
          }
          return;
        }

        if (!authenticated) {
          socket.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
          return;
        }

        if (message.type === 'subscribe_trip') {
          const tripId = message.tripId;
          const memberCheck = await queryOne('SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, socket.userId]);
          if (!memberCheck) {
            socket.send(JSON.stringify({ type: 'error', error: 'Not a member' }));
            return;
          }

          if (socket.tripId) {
            const prev = tripConnections.get(socket.tripId);
            if (prev) { prev.delete(socket); if (prev.size === 0) tripConnections.delete(socket.tripId); }
          }

          socket.tripId = tripId;
          if (!tripConnections.has(tripId)) tripConnections.set(tripId, new Set());
          tripConnections.get(tripId)!.add(socket);
          socket.send(JSON.stringify({ type: 'subscribed', tripId }));

          const liveLocations = await getLiveLocations(tripId);
          const enriched = await Promise.all(liveLocations.map(loc => enrichLocation(tripId, loc)));
          socket.send(JSON.stringify({ type: 'initial_locations', locations: enriched }));
        }

        if (message.type === 'unsubscribe_trip') {
          if (socket.tripId) {
            const conns = tripConnections.get(socket.tripId);
            if (conns) { conns.delete(socket); if (conns.size === 0) tripConnections.delete(socket.tripId); }
            socket.tripId = undefined;
          }
        }
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
      }
    });

    socket.on('close', () => {
      if (socket.tripId) {
        const conns = tripConnections.get(socket.tripId);
        if (conns) { conns.delete(socket); if (conns.size === 0) tripConnections.delete(socket.tripId); }
      }
    });
  });

  const heartbeatInterval = setInterval(() => {
    app.websocketServer?.clients.forEach((ws: WebSocket) => {
      const socket = ws as TripWebSocket;
      if (socket.isAlive === false) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
    });
  }, 30000);

  app.websocketServer?.on('close', () => clearInterval(heartbeatInterval));
}

export async function broadcastToTrip(tripId: string, data: any) {
  const connections = tripConnections.get(tripId);
  if (!connections) return;

  const deviceInfo = await getDeviceInfoForLocation(tripId, data.deviceId);
  const enriched = { ...data, ...deviceInfo };
  const message = JSON.stringify(enriched);

  connections.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  });
}

export function broadcastTripEvent(tripId: string, event: any) {
  const connections = tripConnections.get(tripId);
  if (!connections) return;
  const message = JSON.stringify(event);
  connections.forEach((socket) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  });
}
