import type { ReactNode } from 'react';
import { cn } from './cn';

type Tone = 'neutral' | 'accent' | 'live' | 'warning' | 'danger';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-inset text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  live: 'bg-live-soft text-live',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

export default function Badge({
  tone = 'neutral',
  children,
  className,
  dot,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
