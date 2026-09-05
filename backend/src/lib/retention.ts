// Enforces the retention promise the README makes.
//
// LOCATION_EXPIRY_DAYS was parsed by the config module and then never referenced: there
// was no expiry job, no TTL and no DELETE anywhere, so location history grew forever.

import { config } from '../config';
import { queryAll, queryOne, run } from '../db';
import { clearTripMemberPositions } from './sharing';
import { isoDaysAgo } from './time';

let timer: NodeJS.Timeout | null = null;
let sharingTimer: NodeJS.Timeout | null = null;

export async function sweepExpiredLocations(): Promise<number> {
  const cutoff = isoDaysAgo(config.LOCATION_EXPIRY_DAYS);
  const before = await queryOne<{ count: number | string }>(
    'SELECT COUNT(*) AS count FROM locations WHERE timestamp < $1',
    [cutoff],
  );
  const doomed = Number(before?.count ?? 0);
  if (doomed === 0) return 0;

  await run('DELETE FROM locations WHERE timestamp < $1', [cutoff]);
  console.log(`[retention] deleted ${doomed} location rows older than ${config.LOCATION_EXPIRY_DAYS} days`);
  return doomed;
}

/** Audit entries are kept longer than positions — they are the record of who saw what. */
export async function sweepExpiredAuditLogs(): Promise<void> {
  const cutoff = isoDaysAgo(config.LOCATION_EXPIRY_DAYS * 12);
  await run('DELETE FROM audit_logs WHERE created_at < $1', [cutoff]);
}

/**
 * Enforces the time-limited consent levels.
 *
 * 'once' and 'while_using' both promise that sharing stops when the member leaves the
 * trip screen. The client says so explicitly when it can, but a closed laptop, a killed
 * tab or a dead battery never gets the chance — and the flag would stay true forever.
 * A member on one of those levels who has reported no position for
 * SHARING_IDLE_MINUTES is switched off here.
 *
 * 'always' is exempt: that level exists precisely to survive a gap in reporting.
 */
export async function sweepIdleSharing(): Promise<number> {
  const cutoff = new Date(Date.now() - config.SHARING_IDLE_MINUTES * 60_000).toISOString();

  const idle = await queryAll<{ trip_id: string; user_id: string }>(
    `SELECT tm.trip_id, tm.user_id
       FROM trip_members tm
      WHERE tm.is_sharing = true
        AND tm.consent_level IN ('once', 'while_using')
        AND COALESCE(
              (SELECT MAX(l.timestamp)
                 FROM locations l
                 JOIN devices d ON l.device_id = d.id
                WHERE d.trip_id = tm.trip_id AND d.user_id = tm.user_id),
              tm.sharing_started_at,
              tm.joined_at
            ) < $1`,
    [cutoff],
  );

  for (const row of idle) {
    await run(
      'UPDATE trip_members SET is_sharing = $1, consent_given = $2, sharing_started_at = NULL WHERE trip_id = $3 AND user_id = $4',
      [false, false, row.trip_id, row.user_id],
    );
    await clearTripMemberPositions(row.trip_id, row.user_id);
  }

  if (idle.length > 0) {
    console.log(`[consent] cleared sharing for ${idle.length} idle member(s)`);
  }
  return idle.length;
}

export function startRetentionJob(): void {
  const intervalMs = config.RETENTION_SWEEP_HOURS * 60 * 60 * 1000;
  const sweep = () => {
    Promise.all([sweepExpiredLocations(), sweepExpiredAuditLogs()]).catch((err) =>
      console.error('[retention] sweep failed:', (err as Error).message),
    );
  };
  sweep();
  timer = setInterval(sweep, intervalMs);
  timer.unref();

  const sharingSweep = () => {
    sweepIdleSharing().catch((err) => console.error('[consent] sweep failed:', (err as Error).message));
  };
  sharingSweep();
  sharingTimer = setInterval(sharingSweep, config.SHARING_SWEEP_SECONDS * 1000);
  sharingTimer.unref();
}

export function stopRetentionJob(): void {
  if (timer) clearInterval(timer);
  if (sharingTimer) clearInterval(sharingTimer);
  timer = null;
  sharingTimer = null;
}
