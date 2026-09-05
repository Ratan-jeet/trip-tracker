// Row -> API shape conversion lived inline in every route, restated once per endpoint.

import { bool } from './access';
import { rowTimestamp } from './time';

export const toUser = (row: any) => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  phone: row.phone ?? null,
  avatarUrl: row.avatar_url ?? null,
  twoFactorEnabled: bool(row.two_factor_enabled),
  createdAt: rowTimestamp(row.created_at),
});

export const toTripSummary = (row: any) => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  inviteCode: row.invite_code,
  isActive: bool(row.is_active),
  role: row.role,
  isSharing: bool(row.is_sharing),
  consentGiven: bool(row.consent_given),
  consentLevel: row.consent_level ?? null,
  memberCount: Number(row.member_count ?? 0),
  sharingCount: Number(row.sharing_count ?? 0),
  createdAt: rowTimestamp(row.created_at),
});

export const toMember = (row: any) => ({
  userId: row.user_id,
  role: row.role,
  isSharing: bool(row.is_sharing),
  consentGiven: bool(row.consent_given),
  consentLevel: row.consent_level ?? null,
  displayName: row.display_name,
  avatarUrl: row.avatar_url ?? null,
  joinedAt: rowTimestamp(row.joined_at),
  sharingStartedAt: rowTimestamp(row.sharing_started_at),
});

export const toDevice = (row: any) => ({
  id: row.id,
  deviceType: row.device_type,
  name: row.name,
  imei: row.imei ?? null,
  isActive: bool(row.is_active),
  // ownerId is what the client matches on. Matching by display name (as the UI used to)
  // silently mixes up two members who share a name.
  ownerId: row.user_id ?? null,
  ownerName: row.owner_name ?? null,
});

export const toRoute = (row: any) =>
  row
    ? {
        id: row.id,
        destinationName: row.destination_name,
        destinationLat: Number(row.destination_lat),
        destinationLng: Number(row.destination_lng),
        waypoints: parseWaypoints(row.waypoints),
        createdBy: row.created_by,
        createdAt: rowTimestamp(row.created_at),
      }
    : null;

export const toHistoryPoint = (row: any) => ({
  lat: Number(row.lat),
  lng: Number(row.lng),
  accuracy: numberOrNull(row.accuracy),
  speed: numberOrNull(row.speed),
  heading: numberOrNull(row.heading),
  batteryLevel: numberOrNull(row.battery_level),
  ignitionStatus: row.ignition_status == null ? null : bool(row.ignition_status),
  timestamp: rowTimestamp(row.timestamp),
  deviceId: row.device_id,
  deviceType: row.device_type,
  deviceName: row.device_name,
  ownerId: row.owner_id ?? null,
  ownerName: row.owner_name ?? null,
});

// `value || null` turned a genuine 0 (stopped, due north, empty battery) into null.
function numberOrNull(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function parseWaypoints(value: unknown): Array<{ lat: number; lng: number }> {
  if (Array.isArray(value)) return value as Array<{ lat: number; lng: number }>;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
