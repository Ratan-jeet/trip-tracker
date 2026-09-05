import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { queryAll, queryOne, run, transaction } from '../db';
import { clearTrip, publishTripEvent } from '../db/cache';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { newId, newInviteCode, normaliseInviteCode } from '../lib/ids';
import { nowIso, rowTimestamp } from '../lib/time';
import { toDevice, toMember, toRoute, toTripSummary } from '../lib/mappers';
import { bool, getMembership, requireActiveTrip, requireAdmin, requireMembership } from '../lib/access';
import { clearTripMemberPositions } from '../lib/sharing';

const createTripSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const joinTripSchema = z.object({
  inviteCode: z.string().trim().min(4).max(20),
  // Joining is an act of consent, so the client has to say what it is consenting to.
  consentLevel: z.enum(['once', 'while_using', 'always']).default('while_using'),
  startSharing: z.boolean().default(false),
});

const shareSchema = z.object({
  isSharing: z.boolean(),
  consentLevel: z.enum(['once', 'while_using', 'always']).optional(),
});

const routeSchema = z.object({
  destinationName: z.string().trim().min(1).max(200),
  destinationLat: z.number().min(-90).max(90),
  destinationLng: z.number().min(-180).max(180),
  waypoints: z
    .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
    .max(25)
    .optional(),
});

const memberTargetSchema = z.object({ targetUserId: z.string().min(1).max(40) });

/** Invite codes are unique; retry rather than surfacing a constraint violation as a 500. */
async function allocateInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = newInviteCode();
    const clash = await queryOne('SELECT id FROM trips WHERE invite_code = $1', [code]);
    if (!clash) return code;
  }
  throw new Error('Could not allocate a unique invite code');
}

/**
 * Stop a member's live feed everywhere: drop their cached positions and tell every
 * instance to close their sockets for this trip. Without this a removed member kept
 * receiving positions until they happened to disconnect. Shared with the idle-consent
 * sweep so both paths behave the same.
 */
const revokeAccess = clearTripMemberPositions;

export default async function tripRoutes(app: FastifyInstance) {
  app.post('/api/trips', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.currentUserId;
    const body = createTripSchema.parse(request.body);
    const tripId = newId();
    const inviteCode = await allocateInviteCode();
    const now = nowIso();

    await transaction(async () => {
      await run(
        `INSERT INTO trips (id, name, description, invite_code, creator_id, start_date, end_date, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [tripId, body.name, body.description || null, inviteCode, userId, body.startDate || null, body.endDate || null, true, now, now],
      );
      // The creator opts in explicitly from the UI, exactly like anyone else.
      await run(
        `INSERT INTO trip_members (id, trip_id, user_id, role, is_sharing, consent_given, consent_level, joined_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newId(), tripId, userId, 'admin', false, false, 'while_using', now],
      );
    });

    await audit({ userId, action: 'create_trip', resourceType: 'trip', resourceId: tripId, tripId, request });

    return reply.status(201).send({
      id: tripId,
      name: body.name,
      description: body.description ?? null,
      inviteCode,
      isActive: true,
      role: 'admin',
      isSharing: false,
      consentGiven: false,
      memberCount: 1,
      createdAt: now,
    });
  });

  app.get('/api/trips', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const rows = await queryAll<any>(
      `SELECT t.id, t.name, t.description, t.invite_code, t.is_active, t.created_at,
              tm.role, tm.is_sharing, tm.consent_given, tm.consent_level,
              (SELECT COUNT(*) FROM trip_members WHERE trip_id = t.id) AS member_count,
              (SELECT COUNT(*) FROM trip_members WHERE trip_id = t.id AND is_sharing = true) AS sharing_count
         FROM trips t
         JOIN trip_members tm ON t.id = tm.trip_id
        WHERE tm.user_id = $1
        ORDER BY t.is_active DESC, t.created_at DESC`,
      [request.currentUserId],
    );

    // The invite code is only ever handed to members, and is rotatable —
    // see POST /api/trips/:tripId/invite-code.
    return rows.map(toTripSummary);
  });

  app.get('/api/trips/:tripId', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    const membership = await requireMembership(tripId, userId);

    const trip = await queryOne<any>(
      `SELECT t.*, u.display_name AS creator_name
         FROM trips t JOIN users u ON t.creator_id = u.id
        WHERE t.id = $1`,
      [tripId],
    );
    if (!trip) throw notFound('Trip not found', 'TRIP_NOT_FOUND');

    const members = await queryAll<any>(
      `SELECT tm.user_id, tm.role, tm.is_sharing, tm.consent_given, tm.consent_level, tm.joined_at,
              tm.sharing_started_at, u.display_name, u.avatar_url
         FROM trip_members tm JOIN users u ON tm.user_id = u.id
        WHERE tm.trip_id = $1
        ORDER BY tm.joined_at ASC`,
      [tripId],
    );

    const devices = await queryAll<any>(
      `SELECT d.id, d.device_type, d.name, d.imei, d.is_active, d.user_id, u.display_name AS owner_name
         FROM devices d LEFT JOIN users u ON d.user_id = u.id
        WHERE d.trip_id = $1 AND d.is_active = true`,
      [tripId],
    );

    const route = await queryOne<any>(
      `SELECT id, destination_name, destination_lat, destination_lng, waypoints, created_by
         FROM trip_routes WHERE trip_id = $1`,
      [tripId],
    );

    return {
      id: trip.id,
      name: trip.name,
      description: trip.description,
      inviteCode: trip.invite_code,
      creatorId: trip.creator_id,
      creatorName: trip.creator_name,
      isActive: bool(trip.is_active),
      startDate: rowTimestamp(trip.start_date),
      endDate: rowTimestamp(trip.end_date),
      createdAt: rowTimestamp(trip.created_at),
      memberRole: membership.role,
      isSharing: bool(membership.is_sharing),
      consentGiven: bool(membership.consent_given),
      consentLevel: membership.consent_level,
      members: members.map(toMember),
      devices: devices.map(toDevice),
      route: toRoute(route),
    };
  });

  app.post(
    '/api/trips/join',
    { preHandler: [app.authenticate], config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    async (request: FastifyRequest) => {
      const userId = request.currentUserId;
      const body = joinTripSchema.parse(request.body);
      // Lookups were case-sensitive, so a code typed in lowercase simply did not match.
      const code = normaliseInviteCode(body.inviteCode);

      const trip = await queryOne<any>('SELECT id, name, is_active FROM trips WHERE invite_code = $1', [code]);
      if (!trip) throw notFound('That invite code does not match a trip', 'BAD_INVITE_CODE');
      if (!bool(trip.is_active)) throw badRequest('This trip has ended', 'TRIP_ENDED');

      const existing = await getMembership(trip.id, userId);
      if (existing) throw conflict('You are already a member of this trip', 'ALREADY_MEMBER');

      const now = nowIso();
      await run(
        `INSERT INTO trip_members (id, trip_id, user_id, role, is_sharing, consent_given, consent_level, joined_at, sharing_started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newId(),
          trip.id,
          userId,
          'member',
          body.startSharing,
          body.startSharing,
          body.consentLevel,
          now,
          body.startSharing ? now : null,
        ],
      );

      await audit({
        userId,
        action: 'join_trip',
        resourceType: 'trip',
        resourceId: trip.id,
        tripId: trip.id,
        metadata: { consentLevel: body.consentLevel, startedSharing: body.startSharing },
        request,
      });

      await publishTripEvent(trip.id, { type: 'members_changed' });
      return { tripId: trip.id, tripName: trip.name };
    },
  );

  /**
   * Consent switch. The old handler answered 403 to any request that turned sharing off
   * ("Only admin can end the trip"), so the promise of instant revocation was not
   * merely un-implemented in the UI — the API refused it.
   */
  app.post('/api/trips/:tripId/share', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    const body = shareSchema.parse(request.body);

    const member = await requireMembership(tripId, userId);
    if (body.isSharing) await requireActiveTrip(tripId);

    const now = nowIso();
    const consentLevel = body.consentLevel ?? member.consent_level ?? 'while_using';

    if (body.isSharing) {
      await run(
        `UPDATE trip_members SET is_sharing = $1, consent_given = $2, consent_level = $3, sharing_started_at = $4
           WHERE trip_id = $5 AND user_id = $6`,
        [true, true, consentLevel, now, tripId, userId],
      );
    } else {
      await run(
        `UPDATE trip_members SET is_sharing = $1, consent_given = $2, sharing_started_at = NULL
           WHERE trip_id = $3 AND user_id = $4`,
        [false, false, tripId, userId],
      );
      // Revocation has to take effect now, not at the next poll.
      await revokeAccess(tripId, userId);
    }

    await audit({
      userId,
      action: body.isSharing ? 'sharing_started' : 'sharing_stopped',
      resourceType: 'trip',
      resourceId: tripId,
      tripId,
      metadata: { consentLevel },
      request,
    });

    await publishTripEvent(tripId, { type: 'members_changed' });
    return { isSharing: body.isSharing, consentLevel: body.isSharing ? consentLevel : null };
  });

  app.post('/api/trips/:tripId/leave', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    await requireMembership(tripId, userId);

    const trip = await queryOne<any>('SELECT creator_id FROM trips WHERE id = $1', [tripId]);
    if (trip?.creator_id === userId) {
      throw badRequest('The trip creator cannot leave. End the trip or transfer it first.', 'CREATOR_CANNOT_LEAVE');
    }

    await transaction(async () => {
      await run('UPDATE devices SET is_active = $1 WHERE trip_id = $2 AND user_id = $3', [false, tripId, userId]);
      await run('DELETE FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, userId]);
    });

    await revokeAccess(tripId, userId);
    await audit({ userId, action: 'leave_trip', resourceType: 'trip', resourceId: tripId, tripId, request });
    await publishTripEvent(tripId, { type: 'members_changed' });
    return { success: true };
  });

  app.post('/api/trips/:tripId/remove-member', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    const { targetUserId } = memberTargetSchema.parse(request.body);

    await requireAdmin(tripId, userId);
    if (targetUserId === userId) throw badRequest('Use Leave to remove yourself', 'CANNOT_REMOVE_SELF');

    const trip = await queryOne<any>('SELECT creator_id FROM trips WHERE id = $1', [tripId]);
    if (trip?.creator_id === targetUserId) throw badRequest('The trip creator cannot be removed', 'CANNOT_REMOVE_CREATOR');

    const target = await getMembership(tripId, targetUserId);
    if (!target) throw notFound('That person is not a member of this trip', 'NOT_A_MEMBER');

    await transaction(async () => {
      await run('UPDATE devices SET is_active = $1 WHERE trip_id = $2 AND user_id = $3', [false, tripId, targetUserId]);
      await run('DELETE FROM trip_members WHERE trip_id = $1 AND user_id = $2', [tripId, targetUserId]);
      // Otherwise the person just removed rejoins with the code they already know.
      await run('UPDATE trips SET invite_code = $1, invite_code_rotated_at = $2, updated_at = $2 WHERE id = $3', [
        await allocateInviteCode(),
        nowIso(),
        tripId,
      ]);
    });

    await revokeAccess(tripId, targetUserId);
    await audit({
      userId,
      action: 'member_removed',
      resourceType: 'trip',
      resourceId: tripId,
      tripId,
      metadata: { targetUserId },
      request,
    });
    await publishTripEvent(tripId, { type: 'members_changed' });
    return { success: true, inviteCodeRotated: true };
  });

  /** Lets an admin invalidate a code that has been shared too widely. */
  app.post('/api/trips/:tripId/invite-code', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    await requireAdmin(tripId, userId);

    const inviteCode = await allocateInviteCode();
    const now = nowIso();
    await run('UPDATE trips SET invite_code = $1, invite_code_rotated_at = $2, updated_at = $2 WHERE id = $3', [
      inviteCode,
      now,
      tripId,
    ]);

    await audit({ userId, action: 'rotate_invite_code', resourceType: 'trip', resourceId: tripId, tripId, request });
    await publishTripEvent(tripId, { type: 'invite_code_rotated' });
    return { inviteCode };
  });

  app.post('/api/trips/:tripId/promote', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    const { targetUserId, role } = memberTargetSchema
      .extend({ role: z.enum(['admin', 'member']) })
      .parse(request.body);

    await requireAdmin(tripId, userId);

    const target = await getMembership(tripId, targetUserId);
    if (!target) throw notFound('That person is not a member of this trip', 'NOT_A_MEMBER');

    const trip = await queryOne<any>('SELECT creator_id FROM trips WHERE id = $1', [tripId]);
    // Any admin could previously demote the trip creator.
    if (trip?.creator_id === targetUserId && role !== 'admin') {
      throw forbidden('The trip creator stays an admin', 'CANNOT_DEMOTE_CREATOR');
    }

    await run('UPDATE trip_members SET role = $1 WHERE trip_id = $2 AND user_id = $3', [role, tripId, targetUserId]);
    await audit({
      userId,
      action: 'member_role_changed',
      resourceType: 'trip',
      resourceId: tripId,
      tripId,
      metadata: { targetUserId, role },
      request,
    });
    await publishTripEvent(tripId, { type: 'members_changed' });
    return { success: true, role };
  });

  app.post('/api/trips/:tripId/end', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };

    const trip = await queryOne<any>('SELECT creator_id FROM trips WHERE id = $1', [tripId]);
    if (!trip) throw notFound('Trip not found', 'TRIP_NOT_FOUND');
    if (trip.creator_id !== userId) throw forbidden('Only the trip creator can end the trip', 'NOT_TRIP_CREATOR');

    const now = nowIso();
    await transaction(async () => {
      await run('UPDATE trips SET is_active = $1, updated_at = $2 WHERE id = $3', [false, now, tripId]);
      await run('UPDATE trip_members SET is_sharing = $1, sharing_started_at = NULL WHERE trip_id = $2', [false, tripId]);
      await run('UPDATE devices SET is_active = $1 WHERE trip_id = $2', [false, tripId]);
    });

    await clearTrip(tripId);
    await audit({ userId, action: 'end_trip', resourceType: 'trip', resourceId: tripId, tripId, request });
    await publishTripEvent(tripId, { type: 'trip_ended' });
    return { success: true };
  });

  app.delete('/api/trips/:tripId', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };

    const trip = await queryOne<any>('SELECT creator_id FROM trips WHERE id = $1', [tripId]);
    if (!trip) throw notFound('Trip not found', 'TRIP_NOT_FOUND');
    if (trip.creator_id !== userId) throw forbidden('Only the trip creator can delete it', 'NOT_TRIP_CREATOR');

    await audit({ userId, action: 'delete_trip', resourceType: 'trip', resourceId: tripId, tripId, request });
    await run('DELETE FROM trips WHERE id = $1', [tripId]);
    await clearTrip(tripId);
    await publishTripEvent(tripId, { type: 'trip_deleted' });
    return { success: true };
  });

  app.post('/api/trips/:tripId/route', { preHandler: [app.authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    const body = routeSchema.parse(request.body);

    await requireAdmin(tripId, userId);
    await requireActiveTrip(tripId);

    const routeId = newId();
    const waypoints = body.waypoints ?? [];
    await transaction(async () => {
      await run('DELETE FROM trip_routes WHERE trip_id = $1', [tripId]);
      await run(
        `INSERT INTO trip_routes (id, trip_id, destination_name, destination_lat, destination_lng, waypoints, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [routeId, tripId, body.destinationName, body.destinationLat, body.destinationLng, JSON.stringify(waypoints), userId, nowIso()],
      );
    });

    const route = {
      id: routeId,
      destinationName: body.destinationName,
      destinationLat: body.destinationLat,
      destinationLng: body.destinationLng,
      waypoints,
      createdBy: userId,
    };

    await audit({ userId, action: 'route_set', resourceType: 'trip', resourceId: tripId, tripId, request });
    await publishTripEvent(tripId, { type: 'route_update', route });
    return reply.status(201).send(route);
  });

  app.delete('/api/trips/:tripId/route', { preHandler: [app.authenticate] }, async (request: FastifyRequest) => {
    const userId = request.currentUserId;
    const { tripId } = request.params as { tripId: string };
    await requireAdmin(tripId, userId);

    await run('DELETE FROM trip_routes WHERE trip_id = $1', [tripId]);
    await audit({ userId, action: 'route_deleted', resourceType: 'trip', resourceId: tripId, tripId, request });
    await publishTripEvent(tripId, { type: 'route_update', route: null });
    return { success: true };
  });
}
