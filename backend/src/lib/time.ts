// Every timestamp this service stores or compares is an ISO-8601 string in UTC
// with a trailing Z, written explicitly by application code. Mixing `datetime('now')`
// (which yields "2026-08-30 07:10:12") with client ISO strings carrying an offset
// makes the TEXT comparisons SQLite uses for range queries silently wrong.

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIsoUtc(value: string | number | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Normalise a client-supplied timestamp. Devices with a wrong clock (or a caller
 * deliberately back/post-dating a fix) must not be able to write arbitrary points
 * into a trip's history, so anything outside the accepted window falls back to
 * server time.
 */
export function clampClientTimestamp(
  value: string | undefined,
  opts: { futureSkewMin: number; pastSkewMin: number },
): { timestamp: string; adjusted: boolean } {
  const serverNow = Date.now();
  if (!value) return { timestamp: new Date(serverNow).toISOString(), adjusted: false };

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { timestamp: new Date(serverNow).toISOString(), adjusted: true };
  }

  const delta = parsed.getTime() - serverNow;
  if (delta > opts.futureSkewMin * 60_000 || -delta > opts.pastSkewMin * 60_000) {
    return { timestamp: new Date(serverNow).toISOString(), adjusted: true };
  }
  return { timestamp: parsed.toISOString(), adjusted: false };
}

/** Timestamps come back as Date (pg) or ISO text (sqlite); normalise for the API. */
export function rowTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return toIsoUtc(String(value));
}
