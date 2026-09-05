'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, type ConsentLevel } from '@/lib/api';
import { useStore } from '@/lib/store';
import CreateTripModal from '@/components/CreateTripModal';
import JoinTripModal from '@/components/JoinTripModal';
import ThemeToggle from '@/components/ThemeToggle';
import TripList from '@/components/TripList';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { initialsOf } from '@/lib/format';

export default function DashboardPage() {
  const router = useRouter();
  const toast = useToast();
  const { token, user, trips, hydrated, hydrate, fetchTrips, createTrip, joinTrip, logout } = useStore();

  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    fetchTrips()
      .catch((err) => toast.error(err instanceof ApiError ? err.message : 'Could not load your trips'))
      .finally(() => setLoading(false));
  }, [hydrated, token, router, fetchTrips, toast]);

  const handleCreate = async (name: string, description?: string) => {
    const trip = await createTrip(name, description);
    toast.success('Trip created — share the invite code to bring people in.');
    router.push(`/trip/${trip.id}`);
  };

  const handleJoin = async (code: string, consentLevel: ConsentLevel, startSharing: boolean) => {
    await joinTrip(code, consentLevel, startSharing);
    toast.success('You have joined the trip.');
  };

  if (!hydrated || loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="h-8 w-8 text-accent" label="Loading your trips" />
      </div>
    );
  }

  const active = trips.filter((t) => t.isActive);
  const ended = trips.filter((t) => !t.isActive);

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-5 pb-16 pt-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="grid h-10 w-10 place-items-center rounded-full bg-accent text-[13px] font-bold text-accent-fg"
            aria-hidden="true"
          >
            {initialsOf(user?.displayName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-fg">{user?.displayName}</p>
            <p className="truncate text-xs text-fg-muted">{user?.email}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              logout();
              router.replace('/login');
            }}
          >
            Sign out
          </Button>
        </div>
      </header>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-fg">Your trips</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowJoin(true)}>
            Join with a code
          </Button>
          <Button
            onClick={() => setShowCreate(true)}
            icon={
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            }
          >
            New trip
          </Button>
        </div>
      </div>

      {trips.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border-strong px-6 py-14 text-center">
          <h2 className="text-base font-semibold text-fg">No trips yet</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-fg-muted">
            Create a trip and share the invite code, or join one someone has already set up. Nothing is shared until you
            switch it on.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={() => setShowJoin(true)}>
              Join with a code
            </Button>
            <Button onClick={() => setShowCreate(true)}>Create a trip</Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {active.length > 0 && <TripList trips={active} />}
          {ended.length > 0 && (
            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Ended</h2>
              <TripList trips={ended} />
            </section>
          )}
        </div>
      )}

      {showCreate && <CreateTripModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      {showJoin && <JoinTripModal onClose={() => setShowJoin(false)} onJoin={handleJoin} />}
    </main>
  );
}
