// Live position store + cross-instance fan-out.
//
// Two problems with the previous version:
//   1. `getRedis()` refused any URL equal to redis://localhost:6379, so the Redis in
//      docker-compose was never actually used and every deployment silently ran on the
//      in-process Map.
//   2. Even with Redis connected, WebSocket fan-out stayed in-process. With more than
//      one instance, members connected to different instances never saw each other.
//
// Redis is now used whenever REDIS_URL is set, and broadcasts travel over pub/sub so any
// instance can deliver an update produced by any other.

import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { config } from '../config';

export interface LivePosition {
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  batteryLevel?: number | null;
  ignitionStatus?: boolean | null;
  timestamp: string;
  updatedAt: number;
}

const CHANNEL = 'trip-tracker:events';
/** Identifies this process so it can ignore the echo of its own publishes. */
const INSTANCE_ID = randomBytes(8).toString('hex');

let redis: any = null;
let subscriber: any = null;
let connecting: Promise<any> | null = null;

const memory = new Map<string, Map<string, LivePosition>>();
/** Local delivery path, also the fallback when Redis is absent. */
export const events = new EventEmitter();
events.setMaxListeners(0);

function liveKey(tripId: string): string {
  return `trip:${tripId}:locations`;
}

async function connect(): Promise<any> {
  if (redis) return redis;
  if (!config.REDIS_URL) return null;
  if (connecting) return connecting;

  connecting = (async () => {
    const Redis = require('ioredis');
    const options = {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times: number) => (times > 5 ? null : Math.min(times * 200, 2000)),
    };
    const client = new Redis(config.REDIS_URL, options);
    client.on('error', (err: Error) => console.error('[cache] redis error:', err.message));

    try {
      await client.connect();
      await client.ping();
    } catch (err) {
      console.warn(`[cache] Redis unavailable (${(err as Error).message}); using in-memory store.`);
      client.disconnect();
      connecting = null;
      return null;
    }

    subscriber = client.duplicate();
    subscriber.on('error', (err: Error) => console.error('[cache] redis subscriber error:', err.message));
    await subscriber.connect();
    await subscriber.subscribe(CHANNEL);
    subscriber.on('message', (_channel: string, payload: string) => {
      try {
        const { tripId, event, origin } = JSON.parse(payload);
        // Redis echoes our own publishes back to us; the local emit already delivered them.
        if (origin === INSTANCE_ID) return;
        events.emit('trip-event', tripId, event);
      } catch {
        /* ignore malformed payloads from other publishers */
      }
    });

    redis = client;
    console.log('[cache] connected to Redis');
    return client;
  })();

  return connecting;
}

export async function initCache(): Promise<void> {
  if (!config.REDIS_URL) {
    console.log('[cache] REDIS_URL not set — live positions kept in process memory (single instance only).');
    return;
  }
  await connect();
}

export async function setLivePosition(tripId: string, deviceId: string, data: LivePosition): Promise<void> {
  const client = await connect();
  if (client) {
    const key = liveKey(tripId);
    await client.pipeline().hset(key, deviceId, JSON.stringify(data)).expire(key, config.LIVE_CACHE_TTL_SEC).exec();
    return;
  }
  if (!memory.has(tripId)) memory.set(tripId, new Map());
  memory.get(tripId)!.set(deviceId, data);
}

export async function getLivePositions(tripId: string): Promise<Array<LivePosition & { deviceId: string }>> {
  const client = await connect();
  if (client) {
    const data = await client.hgetall(liveKey(tripId));
    return Object.entries(data).flatMap(([deviceId, json]) => {
      try {
        return [{ deviceId, ...(JSON.parse(json as string) as LivePosition) }];
      } catch {
        return [];
      }
    });
  }
  const trip = memory.get(tripId);
  if (!trip) return [];
  return Array.from(trip.entries()).map(([deviceId, data]) => ({ deviceId, ...data }));
}

export async function removeLivePosition(tripId: string, deviceId: string): Promise<void> {
  const client = await connect();
  if (client) {
    await client.hdel(liveKey(tripId), deviceId);
    return;
  }
  memory.get(tripId)?.delete(deviceId);
}

/** Drop every cached position for a trip — used when a trip ends. */
export async function clearTrip(tripId: string): Promise<void> {
  const client = await connect();
  if (client) {
    await client.del(liveKey(tripId));
    return;
  }
  memory.delete(tripId);
}

/**
 * Deliver an event to subscribers of a trip on every instance. Emitted locally first so
 * a single-instance deployment behaves identically with or without Redis.
 */
export async function publishTripEvent(tripId: string, event: Record<string, unknown>): Promise<void> {
  events.emit('trip-event', tripId, event);
  const client = await connect();
  if (client) {
    await client.publish(CHANNEL, JSON.stringify({ tripId, event, origin: INSTANCE_ID }));
  }
}

export async function closeCache(): Promise<void> {
  await subscriber?.quit().catch(() => {});
  await redis?.quit().catch(() => {});
  subscriber = null;
  redis = null;
  connecting = null;
  memory.clear();
}
