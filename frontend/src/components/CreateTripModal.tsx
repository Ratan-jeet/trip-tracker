'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api';
import Button from './ui/Button';
import Modal from './ui/Modal';
import { Field, Input, Textarea } from './ui/Field';

interface CreateTripModalProps {
  onClose: () => void;
  onCreate: (name: string, description?: string) => Promise<void>;
}

export default function CreateTripModal({ onClose, onCreate }: CreateTripModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError('Give the trip a name');

    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), description.trim() || undefined);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the trip');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New trip"
      description="Invite people with the code you get next."
      onClose={onClose}
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="create-trip" loading={busy}>
            Create trip
          </Button>
        </>
      }
    >
      <form id="create-trip" onSubmit={submit} className="space-y-4">
        <Field label="Trip name" required error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Goa, March 2026"
              maxLength={200}
              autoFocus
            />
          )}
        </Field>

        <Field label="Description" hint="Optional">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Four of us driving down over the long weekend."
              maxLength={2000}
            />
          )}
        </Field>

        <p className="rounded-xl bg-surface-inset px-3.5 py-3 text-[13px] text-fg-muted">
          Creating a trip does not start sharing your location. You choose that on the trip screen.
        </p>
      </form>
    </Modal>
  );
}
