'use client';

import Badge from './ui/Badge';
import { cn } from './ui/cn';

interface SharingToggleProps {
  isSharing: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

/**
 * The single most important control in the app, and the one that had no UI at all: there
 * was no way for a member to stop sharing their location from anywhere in the interface.
 */
export default function SharingToggle({ isSharing, disabled, onToggle }: SharingToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={isSharing}
      aria-label={isSharing ? 'Stop sharing your location' : 'Start sharing your location'}
      className={cn(
        'group flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
        'disabled:pointer-events-none disabled:opacity-60',
        isSharing
          ? 'border-live/30 bg-live-soft hover:border-live/50'
          : 'border-border bg-surface hover:border-border-strong',
      )}
    >
      <span
        className={cn(
          'relative grid h-10 w-10 shrink-0 place-items-center rounded-full',
          isSharing ? 'bg-live text-white' : 'bg-surface-inset text-fg-subtle',
        )}
      >
        {isSharing && <span className="absolute inset-0 animate-pulse-ring rounded-full bg-live" aria-hidden="true" />}
        <svg viewBox="0 0 24 24" fill="none" className="relative h-5 w-5">
          {isSharing ? (
            <>
              <path
                d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="10" r="2.5" fill="currentColor" />
            </>
          ) : (
            <>
              <path
                d="M12 21s7-5.3 7-11a7 7 0 0 0-10.9-5.8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path d="M5.6 5.6A7 7 0 0 0 5 10c0 5.7 7 11 7 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </svg>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">
            {isSharing ? 'Sharing your location' : 'Location sharing is off'}
          </span>
          {isSharing && (
            <Badge tone="live" dot>
              Live
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-fg-muted">
          {isSharing ? 'Tap to stop — takes effect immediately' : 'Others cannot see where you are'}
        </span>
      </span>

      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          isSharing ? 'bg-live' : 'bg-border-strong',
        )}
        aria-hidden="true"
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            isSharing ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}
