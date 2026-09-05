'use client';

import { useState } from 'react';
import type { ConsentLevel } from '@/lib/api';
import Button from './ui/Button';
import Modal from './ui/Modal';
import { cn } from './ui/cn';

interface ConsentModalProps {
  tripName: string;
  /** Current state — the dialog either asks to start sharing or confirms stopping. */
  isSharing: boolean;
  onConfirm: (consentLevel: ConsentLevel) => Promise<void>;
  onClose: () => void;
}

// Each of these is enforced: see the consent-level effects in the trip screen and the
// server-side idle sweep that catches a browser closed without warning.
const LEVELS: Array<{ value: ConsentLevel; title: string; detail: string }> = [
  { value: 'once', title: 'Just this once', detail: 'Stops as soon as you leave this screen.' },
  {
    value: 'while_using',
    title: 'While I have the trip open',
    detail: 'Pauses when you switch away, resumes when you come back.',
  },
  { value: 'always', title: 'Until I turn it off', detail: 'Keeps sharing while the trip screen is open.' },
];

/**
 * This component existed in the codebase but was never rendered anywhere, and the API
 * refused to turn sharing off regardless. Both halves now work.
 */
export default function ConsentModal({ tripName, isSharing, onConfirm, onClose }: ConsentModalProps) {
  const [level, setLevel] = useState<ConsentLevel>('while_using');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(level);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (isSharing) {
    return (
      <Modal
        title="Stop sharing your location?"
        onClose={onClose}
        size="sm"
        dismissable={!busy}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Keep sharing
            </Button>
            <Button variant="danger" onClick={submit} loading={busy}>
              Stop sharing
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm leading-relaxed text-fg-muted">
          <p>
            Your live position disappears from <span className="font-medium text-fg">{tripName}</span> immediately, and
            your device stops reporting.
          </p>
          <p className="rounded-xl bg-surface-inset px-3.5 py-3 text-[13px]">
            Positions already recorded stay in the trip history. To erase those too, use{' '}
            <span className="font-medium text-fg">Delete my location data</span> in the trip menu.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Share your live location?"
      description={tripName}
      onClose={onClose}
      dismissable={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Not now
          </Button>
          <Button variant="live" onClick={submit} loading={busy}>
            Start sharing
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-2 text-[13px] text-fg-muted">
          {[
            'Everyone in this trip sees where you are, in real time.',
            'You can stop at any moment — it takes effect instantly.',
            'Sharing also stops on its own after 15 minutes of silence.',
            'Positions are deleted automatically after 30 days.',
          ].map((line) => (
            <li key={line} className="flex gap-2.5">
              <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-live">
                <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-[13px] font-medium text-fg">How long?</legend>
          {LEVELS.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                level === option.value
                  ? 'border-accent bg-accent-soft'
                  : 'border-border hover:border-border-strong hover:bg-surface-inset',
              )}
            >
              <input
                type="radio"
                name="consent-level"
                value={option.value}
                checked={level === option.value}
                onChange={() => setLevel(option.value)}
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--accent))]"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-fg">{option.title}</span>
                <span className="block text-xs text-fg-muted">{option.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}
