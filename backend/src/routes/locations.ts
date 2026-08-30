import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { queryOne, queryAll, run } from '../db/helpers';
import { setLiveLocation, removeLiveLocation, getLiveLocations } from '../db/cache-wrapper';
import { stringify } from 'csv-stringify/sync';

const locationUpdateSchema = z.object({
  tripId: z.string(),
  deviceId: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  batteryLevel: z.number().min(0).max(100).optional(),
  ignitionStatus: z.boolean().optional(),
  timestamp: z.string().optional(),
});

const registerDeviceSchema = z.object({
  tripId: z.string(),
  deviceType: z.enum(['phone', 'vehicle']),
  name: z.string().min(1).max(100),
  imei: z.string().optional(),
});

export default async function locationRoutes(app: FastifyInstance) {
  app.post('/api/devices', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const body = registerDeviceSchema.parse(request.body);

    const memberCheck = await queryOne('SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2', [body.tripId, userId]);
    if (!memberCheck) {
      return reply.status(403).send({ error: 'Not a member of this trip' });
    }

    if (body.imei) {
      const existingDevice: any = await queryOne('SELECT id, device_type, name, imei FROM devices WHERE trip_id = $1 AND imei = $2', [body.tripId, body.imei]);
      if (existingDevice) {
        await run('UPDATE devices SET name = $1, is_active = true WHERE id = $2', [body.name, existingDevice.id]);
        return reply.status(200).send({ id: existingDevice.id, deviceType: existingDevice.device_type, name: body.name, imei: existingDevice.imei });
      }
    }

    const deviceId = nanoid();
    await run('INSERT INTO devices (id, user_id, trip_id, device_type, name, imei) VALUES ($1, $2, $3, $4, $5, $6)',
      [deviceId, userId, body.tripId, body.deviceType, body.name, body.imei || null]);

    const device: any = await queryOne('SELECT id, device_type, name, imei FROM devices WHERE id = $1', [deviceId]);
    return reply.status(201).send({
      id: device.id,
      deviceType: device.device_type,
      name: device.name,
      imei: device.imei,
    });
  });

  app.get('/api/trips/:tripId/devices', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };

    const memberCheck = await queryOne('SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    if (!memberCheck) {
      return reply.status(403).send({ error: 'Not a member of this trip' });
    }

    const devices: any[] = await queryAll(
      `SELECT d.id, d.device_type, d.name, d.imei, u.display_name as owner_name
       FROM devices d LEFT JOIN users u ON d.user_id = u.id
       WHERE d.trip_id = $1 AND d.is_active = true ORDER BY d.device_type, d.name`,
      [tripId]
    );

    return reply.send(devices.map(d => ({
      id: d.id, deviceType: d.device_type, name: d.name, imei: d.imei, ownerName: d.owner_name,
    })));
  });

  app.post('/api/location/update', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = locationUpdateSchema.parse(request.body);
    const timestamp = body.timestamp || new Date().toISOString();

    await run(
      `INSERT INTO locations (id, device_id, trip_id, lat, lng, accuracy, speed, heading, battery_level, ignition_status, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [nanoid(), body.deviceId, body.tripId, body.lat, body.lng,
       body.accuracy || null, body.speed || null, body.heading || null,
       body.batteryLevel || null, body.ignitionStatus || false, timestamp]
    );

    const locationData = {
      lat: body.lat, lng: body.lng, accuracy: body.accuracy, speed: body.speed,
      heading: body.heading, batteryLevel: body.batteryLevel, ignitionStatus: body.ignitionStatus,
      timestamp, updatedAt: Date.now(),
    };

    await setLiveLocation(body.tripId, body.deviceId, locationData);

    app.websocketServer?.clients.forEach((client: any) => {
      if (client.readyState === 1 && client.tripId === body.tripId) {
        client.send(JSON.stringify({ type: 'location_update', deviceId: body.deviceId, ...locationData }));
      }
    });

    return reply.send({ success: true });
  });

  app.get('/api/trips/:tripId/live', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };

    const memberCheck = await queryOne('SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    if (!memberCheck) {
      return reply.status(403).send({ error: 'Not a member of this trip' });
    }

    const liveLocations = await getLiveLocations(tripId);
    const devices: any[] = await queryAll(
      `SELECT d.id, d.device_type, d.name, u.display_name as owner_name
       FROM devices d LEFT JOIN users u ON d.user_id = u.id
       WHERE d.trip_id = $1 AND d.is_active = true`, [tripId]
    );

    const deviceMap = new Map(devices.map(d => [d.id, d]));
    const enriched = liveLocations.map(loc => {
      const device = deviceMap.get(loc.deviceId);
      return {
        ...loc,
        deviceType: device?.device_type || 'unknown',
        deviceName: device?.name || 'Unknown Device',
        ownerName: device?.owner_name,
        isStale: Date.now() - new Date(loc.timestamp).getTime() > 120000,
      };
    });

    return reply.send(enriched);
  });

  app.get('/api/trips/:tripId/history', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };
    const { startDate, endDate, deviceId } = request.query as any;

    const memberCheck = await queryOne('SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    if (!memberCheck) {
      return reply.status(403).send({ error: 'Not a member of this trip' });
    }

    let query = `SELECT l.lat, l.lng, l.accuracy, l.speed, l.heading, l.battery_level, l.ignition_status, l.timestamp,
      d.id as device_id, d.device_type, d.name as device_name, u.display_name as owner_name
      FROM locations l JOIN devices d ON l.device_id = d.id LEFT JOIN users u ON d.user_id = u.id WHERE l.trip_id = $1`;
    const params: any[] = [tripId];
    let paramIndex = 2;

    if (startDate) { query += ` AND l.timestamp >= $${paramIndex++}`; params.push(startDate); }
    if (endDate) { query += ` AND l.timestamp <= $${paramIndex++}`; params.push(endDate); }
    if (deviceId) { query += ` AND l.device_id = $${paramIndex++}`; params.push(deviceId); }
    query += ' ORDER BY l.timestamp ASC';

    const records: any[] = await queryAll(query, params);
    return reply.send(records.map(r => ({
      lat: r.lat, lng: r.lng, accuracy: r.accuracy, speed: r.speed, heading: r.heading,
      batteryLevel: r.battery_level, ignitionStatus: !!r.ignition_status, timestamp: r.timestamp,
      deviceId: r.device_id, deviceType: r.device_type, deviceName: r.device_name, ownerName: r.owner_name,
    })));
  });

  app.get('/api/trips/:tripId/export', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };
    const { format, startDate, endDate } = request.query as any;

    const memberCheck = await queryOne('SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    if (!memberCheck) {
      return reply.status(403).send({ error: 'Not a member of this trip' });
    }

    let query = `SELECT l.lat, l.lng, l.accuracy, l.speed, l.heading, l.timestamp,
      d.device_type, d.name as device_name, u.display_name as owner_name
      FROM locations l JOIN devices d ON l.device_id = d.id LEFT JOIN users u ON d.user_id = u.id WHERE l.trip_id = $1`;
    const params: any[] = [tripId];
    let paramIndex = 2;

    if (startDate) { query += ` AND l.timestamp >= $${paramIndex++}`; params.push(startDate); }
    if (endDate) { query += ` AND l.timestamp <= $${paramIndex++}`; params.push(endDate); }
    query += ' ORDER BY l.timestamp ASC';

    const records: any[] = await queryAll(query, params);

    if (format === 'gpx') {
      const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="TripTogetherTracker">\n  <trk>\n    <name>Trip ${tripId}</name>\n    <trkseg>\n${records.map(r => `      <trkpt lat="${r.lat}" lon="${r.lng}">\n        <time>${r.timestamp}</time>\n        <speed>${r.speed || 0}</speed>\n      </trkpt>`).join('\n')}\n    </trkseg>\n  </trk>\n</gpx>`;
      return reply.header('Content-Type', 'application/gpx+xml').header('Content-Disposition', `attachment; filename="trip-${tripId}.gpx"`).send(gpx);
    }

    if (format === 'csv') {
      const csv = stringify(records.map(r => ({
        timestamp: r.timestamp, lat: r.lat, lng: r.lng, accuracy: r.accuracy, speed: r.speed,
        heading: r.heading, deviceType: r.device_type, deviceName: r.device_name, ownerName: r.owner_name,
      })), { header: true });
      return reply.header('Content-Type', 'text/csv').header('Content-Disposition', `attachment; filename="trip-${tripId}.csv"`).send(csv);
    }

    return reply.send(records);
  });

  app.delete('/api/devices/:deviceId', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { deviceId } = request.params as { deviceId: string };

    const device: any = await queryOne('SELECT trip_id FROM devices WHERE id = $1', [deviceId]);
    if (!device) {
      return reply.status(404).send({ error: 'Device not found' });
    }

    const memberCheck = await queryOne('SELECT role FROM trip_members WHERE trip_id = $1 AND user_id = $2', [device.trip_id, userId]);
    if (!memberCheck) {
      return reply.status(403).send({ error: 'Not authorized' });
    }

    await run('UPDATE devices SET is_active = false WHERE id = $1', [deviceId]);
    await removeLiveLocation(device.trip_id, deviceId);
    return reply.send({ success: true });
  });
}
