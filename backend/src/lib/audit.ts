import type { FastifyRequest } from 'fastify';
import { run } from '../db';
import { newId } from './ids';
import { nowIso } from './time';

/**
 * Events worth reconstructing after the fact for a location-sharing app: who consented,
 * who revoked, who read or exported someone else's history, and who changed membership.
 *
 * Individual GPS fixes are deliberately not audited — that would be one audit row per
 * point. The `locations` table already is that record.
 */
export type AuditAction =
  | 'register'
  | 'login'
  | 'login_failed'
  | 'logout_all'
  | '2fa_enabled'
  | '2fa_disabled'
  | 'create_trip'
  | 'join_trip'
  | 'leave_trip'
  | 'end_trip'
  | 'delete_trip'
  | 'rotate_invite_code'
  | 'sharing_started'
  | 'sharing_stopped'
  | 'member_removed'
  | 'member_role_changed'
  | 'device_registered'
  | 'device_removed'
  | 'device_token_rotated'
  | 'history_viewed'
  | 'history_exported'
  | 'data_purged'
  | 'route_set'
  | 'route_deleted';

interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  resourceType: 'user' | 'trip' | 'device' | 'location';
  resourceId?: string | null;
  tripId?: string | null;
  metadata?: Record<string, unknown>;
  request?: FastifyRequest;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await run(
      `INSERT INTO audit_logs (id, user_id, trip_id, action, resource_type, resource_id, metadata, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        newId(),
        entry.userId,
        entry.tripId ?? null,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.request?.ip ?? null,
        nowIso(),
      ],
    );
  } catch (err) {
    // An audit write must never take a request down with it, but it must be visible.
    console.error('[audit] failed to record', entry.action, (err as Error).message);
  }
}
