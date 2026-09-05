'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, locationApi, tripApi } from '@/lib/api';
import { useStore } from '@/lib/store';
import Button from './ui/Button';
import Modal from './ui/Modal';
import Spinner from './ui/Spinner';
import { Field, Input } from './ui/Field';
import { cn } from './ui/cn';

interface SetRouteModalProps {
  tripId: string;
  onClose: () => void;
  onRouteSet: () => void;
}

interface Place {
  name: string;
  fullName: string;
  lat: number;
  lng: number;
}

export default function SetRouteModal({ tripId, onClose, onRouteSet }: SetRouteModalProps) {
  const token = useStore((s) => s.token);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // Debounced search-as-you-type, replacing the search button.
  useEffect(() => {
    if (!token || query.trim().length < 3 || selected?.name === query) {
      setResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      controller.current?.abort();
      controller.current = new AbortController();
      setSearching(true);
      try {
        setResults(await locationApi.geocode(token, tripId, query.trim(), controller.current.signal));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [query, token, tripId, selected]);

  useEffect(() => () => controller.current?.abort(), []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return setError('Search for a destination and pick one from the list');

    setBusy(true);
    setError(null);
    try {
      await tripApi.setRoute(token!, tripId, {
        destinationName: selected.name,
        destinationLat: selected.lat,
        destinationLng: selected.lng,
      });
      onRouteSet();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set the destination');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Set destination"
      description="Everyone on the trip sees the route and their distance to it."
      onClose={onClose}
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="set-route" loading={busy} disabled={!selected}>
            Set destination
          </Button>
        </>
      }
    >
      <form id="set-route" onSubmit={submit} className="space-y-4">
        <Field label="Search for a place" error={error}>
          {({ id, describedBy, invalid }) => (
            <div className="relative">
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                }}
                placeholder="Baga Beach, Goa"
                autoFocus
                autoComplete="off"
              />
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle">
                  <Spinner className="h-4 w-4" label="Searching" />
                </span>
              )}
            </div>
          )}
        </Field>

        {results.length > 0 && (
          <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {results.map((place) => (
              <li key={`${place.lat},${place.lng}`}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(place);
                    setQuery(place.name);
                    setResults([]);
                  }}
                  className="block w-full px-3.5 py-2.5 text-left hover:bg-surface-inset"
                >
                  <span className="block text-[13px] font-medium text-fg">{place.name}</span>
                  <span className="block truncate text-xs text-fg-subtle">{place.fullName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className={cn('flex items-start gap-3 rounded-xl border border-accent bg-accent-soft p-3.5')}>
            <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-accent">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">{selected.name}</p>
              <p className="tabular text-xs text-fg-muted">
                {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)}
              </p>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
