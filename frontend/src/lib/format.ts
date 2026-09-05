// Formatting helpers. These lived inside MapView and were imported from there by page
// components, which coupled unrelated modules through a map file.

const STALE_AFTER_MS = 120_000;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return '—';
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return 'Arriving';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  return new Date(Date.now() + seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Speed arrives in m/s. `speed === 0` is a real reading and must render as "0 km/h". */
export function formatSpeed(metresPerSecond: number | null | undefined): string | null {
  if (metresPerSecond == null || !Number.isFinite(metresPerSecond)) return null;
  return `${Math.round(metresPerSecond * 3.6)} km/h`;
}

export function formatClock(timestamp: string | null | undefined): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatRelative(timestamp: string | null | undefined, now = Date.now()): string {
  if (!timestamp) return 'never';
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return 'never';

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * Staleness is derived in the client from the position's timestamp. The API used to send
 * a boolean computed at request time, which then aged in place and never went stale.
 */
export function isStale(timestamp: string | null | undefined, now = Date.now()): boolean {
  if (!timestamp) return true;
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return true;
  return now - then > STALE_AFTER_MS;
}

export function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
