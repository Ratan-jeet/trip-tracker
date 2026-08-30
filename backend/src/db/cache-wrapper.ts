// Unified cache: Redis when REDIS_URL is set, in-memory fallback otherwise

const REDIS_URL = process.env.REDIS_URL;

let redisClient: any = null;
let memoryCache: Map<string, Map<string, any>> = new Map();

async function getRedis() {
  if (redisClient) return redisClient;
  if (!REDIS_URL || REDIS_URL === 'redis://localhost:6379') return null;

  try {
    const Redis = require('ioredis');
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    });
    await redisClient.ping();
    console.log('Connected to Redis.');
    return redisClient;
  } catch (err) {
    console.warn('Redis connection failed, falling back to in-memory cache:', (err as Error).message);
    redisClient = null;
    return null;
  }
}

export async function setLiveLocation(tripId: string, deviceId: string, data: any) {
  const redis = await getRedis();
  const payload = JSON.stringify({ ...data, updatedAt: Date.now() });

  if (redis) {
    const key = `trip:${tripId}:locations`;
    const pipeline = redis.pipeline();
    pipeline.hset(key, deviceId, payload);
    pipeline.expire(key, 300);
    await pipeline.exec();
  } else {
    if (!memoryCache.has(tripId)) memoryCache.set(tripId, new Map());
    memoryCache.get(tripId)!.set(deviceId, JSON.parse(payload));
  }
}

export async function getLiveLocations(tripId: string): Promise<any[]> {
  const redis = await getRedis();

  if (redis) {
    const data = await redis.hgetall(`trip:${tripId}:locations`);
    return Object.entries(data).map(([deviceId, json]) => ({
      deviceId,
      ...JSON.parse(json as string),
    }));
  }

  const trip = memoryCache.get(tripId);
  if (!trip) return [];
  return Array.from(trip.entries()).map(([deviceId, data]) => ({ deviceId, ...data }));
}

export async function removeLiveLocation(tripId: string, deviceId: string) {
  const redis = await getRedis();

  if (redis) {
    await redis.hdel(`trip:${tripId}:locations`, deviceId);
  } else {
    memoryCache.get(tripId)?.delete(deviceId);
  }
}
