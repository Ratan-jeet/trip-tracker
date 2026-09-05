// Membership, consent and device authorisation.
//
// Consent used to be decorative: `is_sharing` and `consent_given` were written at join
// time and never read again. Every position write and every live read now goes through
// these checks, so revoking consent actually stops the flow of data.

import type { FastifyRequest } from 'fastify';
import { queryAll, queryOne } from '../db';
import { forbidden, notFound, unauthorized } from './errors';
import { secretsMatch } from './ids';

export interface MemberRow {
  id: string;
  role: 'admin' | 'member';
  is_sharing: boolean | number;
  consent_given: boolean | number;
  consent_level: string;
}

export interface DeviceRow {
  id: string;
  trip_id: string;
  user_id: string | null;
  device_type: 'phone' | 'vehicle';
  name: string;
  is_active: boolean | number;
  device_token: string | null;
}

/** SQLite returns 0/1 for booleans, Postgres returns real booleans. */
export const bool = (value: unknown): boolean => value === true || value === 1 || value === '1' || value === 't';

export async function getMembership(tripId: string, userId: string): Promise<MemberRow | null> {
  return queryOne<MemberRow>(
    'SELECT id, role, is_sharing, consent_given, consent_level FROM trip_members WHERE trip_id = $1 AND user_id = $2',
    [tripId, userId],
  );
}

export async function requireMembership(tripId: string, userId: string): Promise<MemberRow> {
  const member = await getMembership(tripId, userId);
  if (!member) throw forbidden('Not a member of this trip', 'NOT_A_MEMBER');
  return member;
}

export async function requireAdmin(tripId: string, userId: string): Promise<MemberRow> {
  const member = await requireMembership(tripId, userId);
  if (member.role !== 'admin') throw forbidden('Only trip admins can do that', 'NOT_AN_ADMIN');
  return member;
}

export async function requireActiveTrip(tripId: string): Promise<{ id: string; creator_id: string; name: string }> {
  const trip = await queryOne<{ id: string; creator_id: string; name: string; is_active: boolean | number }>(
    'SELECT id, creator_id, name, is_active FROM trips WHERE id = $1',
    [tripId],
  );
  if (!trip) throw notFound('Trip not found', 'TRIP_NOT_FOUND');
  if (!bool(trip.is_active)) throw forbidden('This trip has ended', 'TRIP_ENDED');
  return trip;
}

/**
 * Resolves who may write a position for a device.
 *
 * `POST /api/location/update` previously had no authentication at all — any caller who
 * knew a trip id and device id (both handed to every trip member by `GET /api/trips/:id`)
 * could inject positions into a stranger's trip. Two callers are legitimate:
 *
 *   - a signed-in user pushing their own phone's position, who must currently be sharing;
 *   - a tracker presenting the device token issued when it was registered.
 */
export async function authoriseDeviceWrite(
  request: FastifyRequest,
  deviceId: string,
  tripId: string,
): Promise<DeviceRow> {
  const device = await queryOne<DeviceRow>(
    'SELECT id, trip_id, user_id, device_type, name, is_active, device_token FROM devices WHERE id = $1',
    [deviceId],
  );
  if (!device || device.trip_id !== tripId) throw notFound('Device not found for this trip', 'DEVICE_NOT_FOUND');
  if (!bool(device.is_active)) throw forbidden('This device is no longer active', 'DEVICE_INACTIVE');

  await requireActiveTrip(tripId);

  const deviceToken = request.headers['x-device-token'];
  if (typeof deviceToken === 'string' && deviceToken.length > 0) {
    if (!secretsMatch(deviceToken, device.device_token)) {
      throw unauthorized('Invalid device token', 'BAD_DEVICE_TOKEN');
    }
  } else {
    // No device token: fall back to a user session, which must own the device.
    let userId: string;
    try {
      await request.jwtVerify();
      userId = (request.user as { userId: string }).userId;
    } catch {
      throw unauthorized('Authentication required to report a location', 'AUTH_REQUIRED');
    }

    if (device.user_id && device.user_id !== userId) {
      throw forbidden('This device belongs to another member', 'NOT_DEVICE_OWNER');
    }
    if (!device.user_id) {
      // Unowned tracker: only an admin may push on its behalf, and only from a session.
      await requireAdmin(tripId, userId);
    }
  }

  // Consent gate. A device whose owner is not currently sharing does not report.
  if (device.user_id) {
    const member = await getMembership(tripId, device.user_id);
    if (!member) throw forbidden('Device owner is no longer a member of this trip', 'OWNER_NOT_MEMBER');
    if (!bool(member.is_sharing) || !bool(member.consent_given)) {
      throw forbidden('Location sharing is turned off for this member', 'SHARING_DISABLED');
    }
  }

  return device;
}

export interface VisibleDevice {
  id: string;
  deviceType: 'phone' | 'vehicle';
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  isSharing: boolean;
}

/**
 * The devices a trip member is allowed to see live: phones belonging to members who are
 * currently sharing, plus the trip's own vehicle trackers. Resolving this once per
 * request also replaces the per-position device lookup the WebSocket layer used to do,
 * which was one query per location on every subscribe.
 *
 * `includeOwnerId` keeps a viewer's own devices in the set regardless of their sharing
 * state. Consent governs what *others* may see; without this, turning sharing off also
 * hid your own recorded history from you and made your own data un-exportable.
 */
export async function getVisibleDevices(
  tripId: string,
  opts: { includeOwnerId?: string } = {},
): Promise<Map<string, VisibleDevice>> {
  const rows = await queryAll<{
    id: string;
    device_type: 'phone' | 'vehicle';
    name: string;
    user_id: string | null;
    owner_name: string | null;
    is_sharing: boolean | number | null;
  }>(
    `SELECT d.id, d.device_type, d.name, d.user_id, u.display_name AS owner_name, tm.is_sharing
       FROM devices d
       LEFT JOIN users u ON d.user_id = u.id
       LEFT JOIN trip_members tm ON tm.trip_id = d.trip_id AND tm.user_id = d.user_id
      WHERE d.trip_id = $1 AND d.is_active = true`,
    [tripId],
  );

  const visible = new Map<string, VisibleDevice>();
  for (const row of rows) {
    // An unowned device is a tracker belonging to the trip itself; an owned one is only
    // visible while its owner's consent stands.
    const sharing = row.user_id === null ? true : bool(row.is_sharing);
    const isOwn = !!opts.includeOwnerId && row.user_id === opts.includeOwnerId;
    if (!sharing && !isOwn) continue;
    visible.set(row.id, {
      id: row.id,
      deviceType: row.device_type,
      name: row.name,
      ownerId: row.user_id,
      ownerName: row.owner_name,
      isSharing: sharing,
    });
  }
  return visible;
}
