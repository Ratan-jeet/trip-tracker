// Server-side routing proxy.
//
// The browser previously called router.project-osrm.org directly — once per member on
// every position change — which handed each member's live coordinates and the trip's
// destination to a third-party demo service, and did it from a consent-first location
// app. Requests now go through here: the caller must be a member of the trip, responses
// are cached briefly, and OSRM_URL can point at your own instance.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { ApiError } from '../lib/errors';
import { requireMembership } from '../lib/access';

const routeQuerySchema = z.object({
  fromLat: z.coerce.number().min(-90).max(90),
  fromLng: z.coerce.number().min(-180).max(180),
  toLat: z.coerce.number().min(-90).max(90),
  toLng: z.coerce.number().min(-180).max(180),
  steps: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

interface CacheEntry {
  expiresAt: number;
  payload: unknown;
}

const cache = new Map<string, CacheEntry>();

const geocodeSchema = z.object({
  q: z.string().trim().min(2).max(200),
});

function cacheGet(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.payload;
}

function cacheSet(key: string, payload: unknown): void {
  // Coordinates move constantly; a short TTL is enough to collapse the burst of
  // identical requests a group of members generates.
  cache.set(key, { expiresAt: Date.now() + config.OSRM_CACHE_TTL_MS, payload });
  if (cache.size > 500) {
    for (const [k, v] of cache) {
      if (v.expiresAt < Date.now()) cache.delete(k);
    }
  }
}

export default async function routingRoutes(app: FastifyInstance) {
  app.get(
    '/api/trips/:tripId/routing',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request: FastifyRequest) => {
      const { tripId } = request.params as { tripId: string };
      await requireMembership(tripId, request.currentUserId);

      const q = routeQuerySchema.parse(request.query);
      // Round to ~11 m so small GPS jitter still hits the same cache entry.
      const round = (n: number) => n.toFixed(4);
      const key = `${round(q.fromLng)},${round(q.fromLat)};${round(q.toLng)},${round(q.toLat)};${q.steps}`;

      const cached = cacheGet(key);
      if (cached) return cached;

      const url =
        `${config.OSRM_URL}/route/v1/driving/` +
        `${q.fromLng},${q.fromLat};${q.toLng},${q.toLat}` +
        `?overview=full&geometries=geojson&steps=${q.steps}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.OSRM_TIMEOUT_MS);

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new ApiError(502, 'Routing service is unavailable', 'ROUTING_UNAVAILABLE');

        const data = (await response.json()) as any;
        if (data.code !== 'Ok' || !data.routes?.length) {
          // No road route (an island, a bad pin). The client falls back to a straight line.
          const empty = { available: false, distance: null, duration: null, geometry: [], steps: [] };
          cacheSet(key, empty);
          return empty;
        }

        const route = data.routes[0];
        const payload = {
          available: true,
          distance: route.distance,
          duration: route.duration,
          geometry: route.geometry?.coordinates ?? [],
          steps: q.steps
            ? (route.legs?.[0]?.steps ?? []).map((s: any) => ({
                type: s.maneuver?.type ?? 'continue',
                modifier: s.maneuver?.modifier ?? null,
                name: s.name || '',
                distance: s.distance,
                duration: s.duration,
                location: s.maneuver?.location ?? null,
              }))
            : [],
        };

        cacheSet(key, payload);
        return payload;
      } catch (err) {
        if (err instanceof ApiError) throw err;
        if ((err as Error).name === 'AbortError') {
          throw new ApiError(504, 'Routing service timed out', 'ROUTING_TIMEOUT');
        }
        throw new ApiError(502, 'Routing service is unavailable', 'ROUTING_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
      }
    },
  );

  /**
   * Place search, proxied for the same reason as routing: the browser called Nominatim
   * directly, which leaked what members search for and sent no identifying User-Agent —
   * something Nominatim's usage policy requires and blocks clients for omitting.
   */
  app.get(
    '/api/trips/:tripId/geocode',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request: FastifyRequest) => {
      const { tripId } = request.params as { tripId: string };
      await requireMembership(tripId, request.currentUserId);

      const { q } = geocodeSchema.parse(request.query);
      const key = `geocode:${q.toLowerCase()}`;
      const cached = cacheGet(key);
      if (cached) return cached;

      const url = `${config.GEOCODER_URL}/search?format=json&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.OSRM_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': config.GEOCODER_USER_AGENT, 'Accept-Language': 'en' },
        });
        if (!response.ok) throw new ApiError(502, 'Place search is unavailable', 'GEOCODER_UNAVAILABLE');

        const raw = (await response.json()) as any[];
        const results = raw.slice(0, 5).map((item) => ({
          name: String(item.display_name ?? '').split(',').slice(0, 2).join(', ').trim(),
          fullName: String(item.display_name ?? ''),
          lat: Number(item.lat),
          lng: Number(item.lon),
        }));

        cacheSet(key, results);
        return results;
      } catch (err) {
        if (err instanceof ApiError) throw err;
        if ((err as Error).name === 'AbortError') throw new ApiError(504, 'Place search timed out', 'GEOCODER_TIMEOUT');
        throw new ApiError(502, 'Place search is unavailable', 'GEOCODER_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
      }
    },
  );
}
