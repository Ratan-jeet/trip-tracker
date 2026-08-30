import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { queryOne, queryAll, run } from '../db/helpers';

const createTripSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const joinTripSchema = z.object({
  inviteCode: z.string().length(8),
});

export default async function tripRoutes(app: FastifyInstance) {
  app.post('/api/trips', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const body = createTripSchema.parse(request.body);
    const inviteCode = nanoid(8).toUpperCase();
    const tripId = nanoid();

    await run('INSERT INTO trips (id, name, description, invite_code, creator_id, start_date, end_date) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [tripId, body.name, body.description || null, inviteCode, userId, body.startDate || null, body.endDate || null]);
    await run('INSERT INTO trip_members (id, trip_id, user_id, role, is_sharing, consent_given, consent_level) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [nanoid(), tripId, userId, 'admin', true, true, 'always']);
    await run('INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
      [nanoid(), userId, 'create_trip', 'trip', tripId, request.ip]);

    const trip: any = await queryOne('SELECT id, name, description, invite_code, created_at FROM trips WHERE id = $1', [tripId]);
    return reply.status(201).send({
      id: trip.id,
      name: trip.name,
      description: trip.description,
      inviteCode: trip.invite_code,
      createdAt: trip.created_at,
    });
  });

  app.get('/api/trips', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const rows: any[] = await queryAll(
      `SELECT t.id, t.name, t.description, t.invite_code, t.is_active, t.created_at,
              tm.role, tm.is_sharing, tm.consent_given,
              (SELECT COUNT(*) FROM trip_members WHERE trip_id = t.id) as member_count
       FROM trips t
       JOIN trip_members tm ON t.id = tm.trip_id
       WHERE tm.user_id = $1
       ORDER BY t.created_at DESC`,
      [userId]
    );
    return reply.send(rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      inviteCode: r.invite_code,
      isActive: !!r.is_active,
      role: r.role,
      isSharing: !!r.is_sharing,
      consentGiven: !!r.consent_given,
      memberCount: parseInt(r.member_count),
      createdAt: r.created_at,
    })));
  });

  app.get('/api/trips/:tripId', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };

    const memberCheck: any = await queryOne('SELECT role FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    if (!memberCheck) {
      return reply.status(403).send({ error: 'Not a member of this trip' });
    }

    const tripResult: any = await queryOne(
      `SELECT t.*, u.display_name as creator_name FROM trips t JOIN users u ON t.creator_id = u.id WHERE t.id = $1`,
      [tripId]
    );
    if (!tripResult) {
      return reply.status(404).send({ error: 'Trip not found' });
    }

    const members: any[] = await queryAll(
      `SELECT tm.user_id, tm.role, tm.is_sharing, tm.consent_given, tm.joined_at, u.display_name, u.avatar_url
       FROM trip_members tm JOIN users u ON tm.user_id = u.id WHERE tm.trip_id = $1`,
      [tripId]
    );

    const devices: any[] = await queryAll(
      'SELECT id, device_type, name, imei, is_active FROM devices WHERE trip_id = $1',
      [tripId]
    );

    const route: any = await queryOne(
      'SELECT id, destination_name, destination_lat, destination_lng, waypoints, created_by FROM trip_routes WHERE trip_id = $1',
      [tripId]
    );

    return reply.send({
      id: tripResult.id,
      name: tripResult.name,
      description: tripResult.description,
      inviteCode: tripResult.invite_code,
      creatorId: tripResult.creator_id,
      creatorName: tripResult.creator_name,
      isActive: !!tripResult.is_active,
      startDate: tripResult.start_date,
      endDate: tripResult.end_date,
      members: members.map(m => ({
        userId: m.user_id, role: m.role, isSharing: !!m.is_sharing,
        consentGiven: !!m.consent_given, displayName: m.display_name,
        avatarUrl: m.avatar_url, joinedAt: m.joined_at,
      })),
      devices: devices.map(d => ({
        id: d.id, deviceType: d.device_type, name: d.name,
        imei: d.imei, isActive: !!d.is_active,
      })),
      memberRole: memberCheck.role,
      route: route ? {
        id: route.id,
        destinationName: route.destination_name,
        destinationLat: route.destination_lat,
        destinationLng: route.destination_lng,
        waypoints: typeof route.waypoints === 'string' ? JSON.parse(route.waypoints) : route.waypoints,
        createdBy: route.created_by,
      } : null,
    });
  });

  app.post('/api/trips/join', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const body = joinTripSchema.parse(request.body);

    const trip: any = await queryOne('SELECT id, name, is_active FROM trips WHERE invite_code = $1', [body.inviteCode]);
    if (!trip) {
      return reply.status(404).send({ error: 'Invalid invite code' });
    }
    if (!trip.is_active) {
      return reply.status(400).send({ error: 'This trip is no longer active' });
    }

    const existing = await queryOne('SELECT id FROM trip_members WHERE trip_id = $1 AND user_id = $2', [trip.id, userId]);
    if (existing) {
      return reply.status(409).send({ error: 'Already a member of this trip' });
    }

    await run('INSERT INTO trip_members (id, trip_id, user_id, role, is_sharing, consent_given, consent_level) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [nanoid(), trip.id, userId, 'member', true, true, 'always']);
    await run('INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, ip_address) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [nanoid(), userId, 'join_trip', 'trip', trip.id, JSON.stringify({ inviteCode: body.inviteCode }), request.ip]);

    return reply.send({ tripId: trip.id, tripName: trip.name });
  });

  app.post('/api/trips/:tripId/leave', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };
    await run('UPDATE devices SET is_active = false WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    await run('DELETE FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    return reply.send({ success: true });
  });

  app.post('/api/trips/:tripId/share', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };
    const { isSharing, consentLevel } = request.body as { isSharing: boolean; consentLevel?: string };

    if (!isSharing) {
      return reply.status(403).send({ error: 'Cannot stop sharing. Only admin can end the trip.' });
    }

    const validLevel = ['once', 'while_using', 'always'].includes(consentLevel || '') ? consentLevel : 'always';
    await run('UPDATE trip_members SET is_sharing = true, consent_given = true, consent_level = $1 WHERE trip_id = $2 AND user_id = $3',
      [validLevel, tripId, userId]);
    return reply.send({ isSharing: true, consentLevel: validLevel });
  });

  app.post('/api/trips/:tripId/end', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };

    const trip: any = await queryOne('SELECT creator_id FROM trips WHERE id = $1', [tripId]);
    if (!trip) {
      return reply.status(404).send({ error: 'Trip not found' });
    }

    if (trip.creator_id !== userId) {
      return reply.status(403).send({ error: 'Only the primary admin can end the trip' });
    }

    await run('UPDATE trips SET is_active = false WHERE id = $1', [tripId]);
    await run('UPDATE trip_members SET is_sharing = false WHERE trip_id = $1', [tripId]);
    await run('UPDATE devices SET is_active = false WHERE trip_id = $1', [tripId]);

    return reply.send({ success: true });
  });

  app.post('/api/trips/:tripId/promote', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };
    const { targetUserId, role } = request.body as { targetUserId: string; role: string };

    const member: any = await queryOne('SELECT role FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    if (!member || member.role !== 'admin') {
      return reply.status(403).send({ error: 'Only admins can promote members' });
    }

    if (!['admin', 'member'].includes(role)) {
      return reply.status(400).send({ error: 'Invalid role' });
    }

    await run('UPDATE trip_members SET role = $1 WHERE trip_id = $2 AND user_id = $3', [role, tripId, targetUserId]);
    return reply.send({ success: true, role });
  });

  app.delete('/api/trips/:tripId', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };
    const check: any = await queryOne('SELECT creator_id FROM trips WHERE id = $1', [tripId]);
    if (!check || check.creator_id !== userId) {
      return reply.status(403).send({ error: 'Only the trip creator can delete it' });
    }
    await run('DELETE FROM trips WHERE id = $1', [tripId]);
    return reply.send({ success: true });
  });

  app.post('/api/trips/:tripId/route', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };
    const { destinationName, destinationLat, destinationLng, waypoints } = request.body as {
      destinationName: string; destinationLat: number; destinationLng: number; waypoints?: { lat: number; lng: number }[];
    };

    const member: any = await queryOne('SELECT role FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    if (!member || member.role !== 'admin') {
      return reply.status(403).send({ error: 'Only admins can set routes' });
    }

    await run('DELETE FROM trip_routes WHERE trip_id = $1', [tripId]);
    const routeId = nanoid();
    await run(
      'INSERT INTO trip_routes (id, trip_id, destination_name, destination_lat, destination_lng, waypoints, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [routeId, tripId, destinationName, destinationLat, destinationLng, JSON.stringify(waypoints || []), userId]
    );

    return reply.status(201).send({
      id: routeId, destinationName, destinationLat, destinationLng, waypoints: waypoints || [], createdBy: userId,
    });
  });

  app.delete('/api/trips/:tripId/route', {
    preHandler: [app.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request.user as any).userId;
    const { tripId } = request.params as { tripId: string };

    const member: any = await queryOne('SELECT role FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    if (!member || member.role !== 'admin') {
      return reply.status(403).send({ error: 'Only admins can delete routes' });
    }

    await run('DELETE FROM trip_routes WHERE trip_id = $1', [tripId]);
    return reply.send({ success: true });
  });
}
