// Stopping a member's live feed, in one place.
//
// The route layer and the idle-consent sweep both need to do exactly the same thing when
// sharing ends: drop the cached positions for that member's devices and tell every
// instance to close their sockets for the trip. Keeping one implementation means a
// revocation triggered by the background sweep behaves identically to one the member
// asked for.

import { queryAll } from '../db';
import { publishTripEvent, removeLivePosition } from '../db/cache';

export async function clearTripMemberPositions(tripId: string, userId: string): Promise<string[]> {
  const devices = await queryAll<{ id: string }>('SELECT id FROM devices WHERE trip_id = $1 AND user_id = $2', [
    tripId,
    userId,
  ]);
  const deviceIds = devices.map((d) => d.id);

  await Promise.all(deviceIds.map((id) => removeLivePosition(tripId, id)));
  await publishTripEvent(tripId, { type: 'access_revoked', userId, deviceIds });

  return deviceIds;
}
