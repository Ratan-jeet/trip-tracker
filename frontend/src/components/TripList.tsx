import Link from 'next/link';
import type { TripSummary } from '@/lib/api';
import Badge from './ui/Badge';

export default function TripList({ trips }: { trips: TripSummary[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {trips.map((trip) => (
        <li key={trip.id}>
          <Link
            href={`/trip/${trip.id}`}
            className="group block rounded-2xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-border-strong hover:bg-surface-inset"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[15px] font-semibold text-fg">{trip.name}</h3>
                {trip.description && <p className="mt-0.5 line-clamp-2 text-[13px] text-fg-muted">{trip.description}</p>}
              </div>
              {!trip.isActive ? (
                <Badge tone="neutral">Ended</Badge>
              ) : trip.isSharing ? (
                <Badge tone="live" dot>
                  Sharing
                </Badge>
              ) : (
                <Badge tone="warning">Not sharing</Badge>
              )}
            </div>

            <div className="mt-3 flex items-center gap-3 text-xs text-fg-muted">
              <span className="tabular">
                {trip.memberCount} {trip.memberCount === 1 ? 'member' : 'members'}
              </span>
              {trip.isActive && (
                <span className="tabular">
                  {trip.sharingCount} sharing now
                </span>
              )}
              {trip.role === 'admin' && <Badge tone="neutral">Admin</Badge>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
