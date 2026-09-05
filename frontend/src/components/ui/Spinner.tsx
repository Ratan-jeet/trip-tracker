import { cn } from './cn';

export default function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-block', className)}>
      <svg viewBox="0 0 24 24" fill="none" className="h-full w-full animate-spin">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
