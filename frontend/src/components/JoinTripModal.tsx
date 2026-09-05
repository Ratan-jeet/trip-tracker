'use client';

import { useState } from 'react';
import { ApiError, type ConsentLevel } from '@/lib/api';
import Button from './ui/Button';
import Modal from './ui/Modal';
import { Field, Input } from './ui/Field';

interface JoinTripModalProps {
  onClose: () => void;
  onJoin: (inviteCode: string, consentLevel: ConsentLevel, startSharing: boolean) => Promise<void>;
}

export default function JoinTripModal({ onClose, onJoin }: JoinTripModalProps) {
  const [code, setCode] = useState('');
  const [startSharing, setStartSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 4) return setError('Enter the 8-character invite code');

    setBusy(true);
    setError(null);
    try {
      await onJoin(trimmed, 'while_using', startSharing);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join the trip');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Join a trip"
      onClose={onClose}
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="join-trip" loading={busy}>
            Join trip
          </Button>
        </>
      }
    >
      <form id="join-trip" onSubmit={submit} className="space-y-4">
        <Field label="Invite code" required error={error} hint="Case does not matter.">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="K7M2XQ4P"
              maxLength={12}
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="text-center text-lg font-semibold tracking-[0.3em] tabular"
            />
          )}
        </Field>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3.5 hover:bg-surface-inset">
          <input
            type="checkbox"
            checked={startSharing}
            onChange={(e) => setStartSharing(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--live))]"
          />
          <span>
            <span className="block text-[13px] font-medium text-fg">Start sharing my location right away</span>
            <span className="block text-xs text-fg-muted">
              Leave this off to join and decide later. You can turn sharing on or off at any time.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
