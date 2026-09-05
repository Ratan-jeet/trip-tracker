import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { stringify } from 'csv-stringify/sync';
import { config } from '../config';
import { queryAll, queryOne, run } from '../db';
import { getLivePositions, publishTripEvent, removeLivePosition, setLivePosition } from '../db/cache';
import { audit } from '../lib/audit';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { newDeviceToken, newId } from '../lib/ids';
import { clampClientTimestamp, nowIso } from '../lib/time';
import { toDevice, toHistoryPoint } from '../lib/mappers';
import { authoriseDeviceWrite, bool, getVisibleDevices, requireActiveTrip, requireMembership } from '../lib/access';

const locationUpdateSchema = z.object({
  tripId: z.string().min(1).max(40),
  deviceId: z.string().min(1).max(40),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  // `.nullish()` rather than `.optional()`: trackers send explicit nulls for unavailable
  // fields, and `0` is a meaningful value for every one of these.
  accuracy: z.number().nonnegative().nullish(),
  speed: z.number().nonnegative().nullish(),
  heading: z.number().min(0).max(360).nullish(),
  batteryLevel: z.number().min(0).max(100).nullish(),
  ignitionStatus: z.boolean().nullish(),
  timestamp: z.string().nullish(),
});

const registerDeviceSchema = z.object({
  tripId: z.string().min(1).max(40),
  deviceType: z.enum(['phone', 'vehicle']),
  name: z.string().trim().min(1).max(100),
  imei: z.string().trim().regex(/^\d{14,17}$/, 'IMEI must be 14-17 digits').optional(),
});

const historyQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  deviceId: z.string().max(40).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const exportQuerySchema = historyQuerySchema.extend({
  format: z.enum(['json', 'csv', 'gpx']).default('json'),
});

/**
 * Spreadsheets treat a leading =, +, - or @ as a formula, so a display name of
 * `=HYPERLINK("http://…"&A1)` runs when a member opens the export. Device and owner names
 * are set by other members, so prefix the cell to keep it inert. csv-stringify quotes and
 * escapes, but it has no reason to know about this.
 */
function csvSafe(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** GPX is XML; an unescaped `&` or `<` in a trip or device name produces a broken file. */
function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A date-only bound like "2026-09-05" means the whole day in UTC. */
function toBoundary(value: string | undefined, edge: 'start' | 'end'): string | null {
  if (!value) return null;
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
    : value;
  const parsed = new Date(withTime);
  if (Number.isNaN(parsed.getTime())) throw badRequest(`Invalid date: ${value}`, 'BAD_DATE');
  return parsed.toISOString();
}

interface HistoryFilters {
  tripId: string;
  startDate?: string;
  endDate?: string;
  deviceId?: string;
  limit: number;
}

async function fetchHistory(filters: HistoryFilters, visibleIds: string[]) {
  if (visibleIds.length === 0) return [];

  const params: unknown[] = [filters.tripId];
  let sql = `SELECT l.lat, l.lng, l.accuracy, l.speed, l.heading, l.battery_level, l.ignition_status, l.timestamp,
                    d.id AS device_id, d.device_type, d.name AS device_name, d.user_id AS owner_id,
                    u.display_name AS owner_name
               FROM locations l
               JOIN devices d ON l.device_id = d.id
               LEFT JOIN users u ON d.user_id = u.id
              WHERE l.trip_id = $1`;

  const placeholders = visibleIds.map((_, i) => `$${params.length + i + 1}`).join(', ');
  sql += ` AND l.device_id IN (${placeholders})`;
  params.push(...visibleIds);

  const start = toBoundary(filters.startDate, 'start');
  if (start) {
    params.push(start);
    sql += ` AND l.timestamp >= $${params.length}`;
  }
  const end = toBoundary(filters.endDate, 'end');
  if (end) {
    params.push(end);
    sql += ` AND l.timestamp <= $${params.length}`;
  }
  if (filters.deviceId) {
    params.push(filters.deviceId);
    sql += ` AND l.device_id = $${params.length}`;
  }

  params.push(filters.limit);
  sql += ` ORDER BY l.timestamp ASC LIMIT $${params.length}`;

  return queryAll<any>(sql, params);
}

export default async function locationRoutes(app: FastifyInstance) {
  app.post('/api/devices', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.currentUserId;
    const body = registerDeviceSchema.parse(request.body);

    await requireMembership(body.tripId, userId);
    await requireActiveTrip(body.tripId);

    if (body.imei) {
      const existing = await queryOne<any>('SELECT id, device_type, name, imei, user_id FROM devices WHERE trip_id = $1 AND imei = $2', [
        body.tripId,
        body.imei,
      ]);
      if (existing) {
        if (existing.user_id && existing.user_id !== userId) {
          throw forbidden('That tracker is already registered to another member', 'DEVICE_CLAIMED');
        }
        // Re-registering rotates the token so a previously issued one stops working.
        const token = newDeviceToken();
        await run('UPDATE devices SET name = $1, is_active = $2, device_token = $3 WHERE id = $4', [
          body.name,
          true,
          token,
          existing.id,
        ]);
        await audit({
          userId,
          action: 'device_token_rotated',
          resourceType: 'device',
          resourceId: existing.id,
          tripId: body.tripId,
          request,
        });
        return reply.send({
          id: existing.id,
          deviceType: existing.device_type,
          name: body.name,
          imei: existing.imei,
          ownerId: userId,
          deviceToken: token,
        });
      }
    }

    // A phone has no IMEI to key on, so nothing stopped a second registration creating a
    // duplicate device — two markers for one person, and history split across both.
    if (body.deviceType === 'phone') {
      const mine = await queryOne<any>(
        `SELECT id, device_type, name, imei FROM devices
          WHERE trip_id = $1 AND user_id = $2 AND device_type = 'phone' AND is_active = true`,
        [body.tripId, userId],
      );
      if (mine) {
        await run('UPDATE devices SET name = $1 WHERE id = $2', [body.name, mine.id]);
        return reply.send({ id: mine.id, deviceType: 'phone', name: body.name, imei: mine.imei, ownerId: userId });
      }
    }

    const deviceId = newId();
    // Vehicle trackers report over HTTP/MQTT with no user session, so they get their own
    // bearer secret. It is returned exactly once, here.
    const deviceToken = body.deviceType === 'vehicle' ? newDeviceToken() : null;

    await run(
      `INSERT INTO devices (id, user_id, trip_id, device_type, name, imei, is_active, device_token, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [deviceId, userId, body.tripId, body.deviceType, body.name, body.imei || null, true, deviceToken, nowIso()],
    );

    await audit({
      userId,
      action: 'device_registered',
      resourceType: 'device',
      resourceId: deviceId,
      tripId: body.tripId,
      metadata: { deviceType: body.deviceType },
      request,
    });
    await publishTripEvent(body.tripId, { type: 'devices_changed' });

    return reply.status(201).send({
      id: deviceId,
      deviceType: body.deviceType,
      name: body.name,
      imei: body.imei ?? null,
      ownerId: userId,
      ...(deviceToken ? { deviceToken } : {}),
    });
  });

  app.get('/api/trips/:tripId/devices', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const { tripId } = request.params as { tripId: string };
    await requireMembership(tripId, request.currentUserId);

    const devices = await queryAll<any>(
      `SELECT d.id, d.device_type, d.name, d.imei, d.is_active, d.user_id, u.display_name AS owner_name
         FROM devices d LEFT JOIN users u ON d.user_id = u.id
        WHERE d.trip_id = $1 AND d.is_active = true
        ORDER BY d.device_type, d.name`,
      [tripId],
    );

    return devices.map(toDevice);
  });

  /**
   * Position ingest. This route had no authentication whatsoever: anyone who learned a
   * trip id and device id could write into a stranger's trip. `authoriseDeviceWrite`
   * now requires either the device's own token or a session belonging to its owner, and
   * refuses the write when that member is not currently sharing.
   */
  app.post(
    '/api/location/update',
    {
      config: {
        rateLimit: {
          max: 240,
          timeWindow: '1 minute',
          // Keyed by caller, not by source address: a group travelling together shares
          // one phone hotspot or hotel NAT, and an IP-keyed budget throttled all of them
          // at once. The rate-limit hook runs onRequest — before body parsing — so this
          // reads the credentials from headers, which are available, rather than
          // `request.body.deviceId`, which is not yet.
          keyGenerator: (request: FastifyRequest) => {
            const credential = request.headers['x-device-token'] ?? request.headers.authorization;
            if (typeof credential !== 'string' || credential.length === 0) return request.ip;
            // Hashed so no bearer secret is used verbatim as a store key.
            return `c:${createHash('sha256').update(credential).digest('base64url').slice(0, 24)}`;
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = locationUpdateSchema.parse(request.body);
      const device = await authoriseDeviceWrite(request, body.deviceId, body.tripId);

      const { timestamp, adjusted } = clampClientTimestamp(body.timestamp ?? undefined, {
        futureSkewMin: config.LOCATION_FUTURE_SKEW_MIN,
        pastSkewMin: config.LOCATION_PAST_SKEW_MIN,
      });

      // `??` not `||`: a speed of 0 (stopped), a heading of 0 (due north) and a battery
      // level of 0 are all real readings that the previous code discarded as null.
      const position = {
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy ?? null,
        speed: body.speed ?? null,
        heading: body.heading ?? null,
        batteryLevel: body.batteryLevel ?? null,
        ignitionStatus: body.ignitionStatus ?? null,
        timestamp,
        updatedAt: Date.now(),
      };

      await run(
        `INSERT INTO locations (id, device_id, trip_id, lat, lng, accuracy, speed, heading, battery_level, ignition_status, timestamp, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newId(),
          device.id,
          body.tripId,
          position.lat,
          position.lng,
          position.accuracy,
          position.speed,
          position.heading,
          position.batteryLevel,
          position.ignitionStatus,
          timestamp,
          nowIso(),
        ],
      );

      await setLivePosition(body.tripId, device.id, position);

      // One fan-out path, and it carries the device metadata clients need. The old inline
      // loop over websocketServer.clients skipped enrichment, so every WebSocket update
      // arrived without a deviceType and rendered as a phone.
      await publishTripEvent(body.tripId, {
        type: 'location_update',
        deviceId: device.id,
        deviceType: device.device_type,
        deviceName: device.name,
        ownerId: device.user_id,
        ...position,
      });

      return reply.send({ success: true, timestamp, ...(adjusted ? { timestampAdjusted: true } : {}) });
    },
  );

  app.get('/api/trips/:tripId/live', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const { tripId } = request.params as { tripId: string };
    await requireMembership(tripId, request.currentUserId);

    const visible = await getVisibleDevices(tripId);
    const positions = await getLivePositions(tripId);

    return positions
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
        // `isStale` is deliberately not sent: it was computed here from Date.now() and
        // then aged in the client. The client has `timestamp` and derives it live.
      });
  });

  app.get('/api/trips/:tripId/history', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    const query = historyQuerySchema.parse(request.query);

    await requireMembership(tripId, userId);
    // Your own devices stay visible to you even after you stop sharing.
    const visible = await getVisibleDevices(tripId, { includeOwnerId: userId });
    const limit = Math.min(query.limit ?? config.HISTORY_MAX_ROWS, config.HISTORY_MAX_ROWS);

    const rows = await fetchHistory({ ...query, tripId, limit: limit + 1 }, [...visible.keys()]);
    const truncated = rows.length > limit;

    await audit({
      userId,
      action: 'history_viewed',
      resourceType: 'location',
      resourceId: tripId,
      tripId,
      metadata: { startDate: query.startDate, endDate: query.endDate, deviceId: query.deviceId, rows: rows.length },
      request,
    });

    return {
      points: rows.slice(0, limit).map(toHistoryPoint),
      truncated,
      limit,
    };
  });

  app.get('/api/trips/:tripId/export', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    const query = exportQuerySchema.parse(request.query);

    await requireMembership(tripId, userId);
    const trip = await queryOne<any>('SELECT name FROM trips WHERE id = $1', [tripId]);
    if (!trip) throw notFound('Trip not found', 'TRIP_NOT_FOUND');

    const visible = await getVisibleDevices(tripId, { includeOwnerId: userId });
    const rows = await fetchHistory({ ...query, tripId, limit: config.EXPORT_MAX_ROWS }, [...visible.keys()]);
    const points = rows.map(toHistoryPoint);

    await audit({
      userId,
      action: 'history_exported',
      resourceType: 'location',
      resourceId: tripId,
      tripId,
      metadata: { format: query.format, rows: points.length },
      request,
    });

    const filename = `trip-${tripId}-${new Date().toISOString().slice(0, 10)}`;

    if (query.format === 'gpx') {
      const trkpts = points
        .map(
          (p) =>
            `      <trkpt lat="${p.lat}" lon="${p.lng}">\n` +
            `        <time>${escapeXml(p.timestamp)}</time>\n` +
            (p.speed == null ? '' : `        <speed>${p.speed}</speed>\n`) +
            `      </trkpt>`,
        )
        .join('\n');
      const gpx =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<gpx version="1.1" creator="Trip Tracker" xmlns="http://www.topografix.com/GPX/1/1">\n` +
        `  <trk>\n    <name>${escapeXml(trip.name)}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>`;
      return reply
        .header('Content-Type', 'application/gpx+xml; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}.gpx"`)
        .send(gpx);
    }

    if (query.format === 'csv') {
      const csv = stringify(
        points.map((p) => ({
          timestamp: p.timestamp,
          lat: p.lat,
          lng: p.lng,
          accuracy: p.accuracy,
          speed: p.speed,
          heading: p.heading,
          batteryLevel: p.batteryLevel,
          deviceType: p.deviceType,
          deviceName: csvSafe(p.deviceName),
          ownerName: csvSafe(p.ownerName),
        })),
        { header: true },
      );
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}.csv"`)
        .send(csv);
    }

    return reply
      .header('Content-Disposition', `attachment; filename="${filename}.json"`)
      .send({ trip: trip.name, exportedAt: nowIso(), points });
  });

  app.delete('/api/devices/:deviceId', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { deviceId } = request.params as { deviceId: string };

    const device = await queryOne<any>('SELECT id, trip_id, user_id FROM devices WHERE id = $1', [deviceId]);
    if (!device) throw notFound('Device not found', 'DEVICE_NOT_FOUND');

    // Membership alone used to be enough, so any member could deactivate anyone's device.
    const member = await requireMembership(device.trip_id, userId);
    const isOwner = device.user_id === userId;
    if (!isOwner && member.role !== 'admin') {
      throw forbidden('Only the device owner or a trip admin can remove this device', 'NOT_DEVICE_OWNER');
    }

    await run('UPDATE devices SET is_active = $1 WHERE id = $2', [false, deviceId]);
    await removeLivePosition(device.trip_id, deviceId);
    await audit({
      userId,
      action: 'device_removed',
      resourceType: 'device',
      resourceId: deviceId,
      tripId: device.trip_id,
      request,
    });
    await publishTripEvent(device.trip_id, { type: 'devices_changed', removedDeviceId: deviceId });
    return { success: true };
  });

  /** Lets a member erase their own recorded positions for a trip. */
  app.delete('/api/trips/:tripId/my-data', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    await requireMembership(tripId, userId);

    const devices = await queryAll<{ id: string }>('SELECT id FROM devices WHERE trip_id = $1 AND user_id = $2', [
      tripId,
      userId,
    ]);
    for (const device of devices) {
      await run('DELETE FROM locations WHERE trip_id = $1 AND device_id = $2', [tripId, device.id]);
      await removeLivePosition(tripId, device.id);
    }

    await audit({
      userId,
      action: 'data_purged',
      resourceType: 'location',
      resourceId: tripId,
      tripId,
      metadata: { devices: devices.length },
      request,
    });
    return { success: true, devicesCleared: devices.length };
  });
}
