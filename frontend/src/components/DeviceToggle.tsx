'use client';

import { cn } from './ui/cn';

type Filter = 'all' | 'phone' | 'vehicle';

const OPTIONS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'phone', label: 'People' },
  { value: 'vehicle', label: 'Vehicles' },
];

export default function DeviceToggle({ filter, onChange }: { filter: Filter; onChange: (filter: Filter) => void }) {
  return (
    <div
      role="group"
      aria-label="Filter what appears on the map"
      className="flex rounded-xl border border-border bg-surface p-0.5 shadow-md"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={filter === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[10px] px-2.5 py-1.5 text-xs font-medium transition-colors',
            filter === option.value ? 'bg-accent text-accent-fg' : 'text-fg-muted hover:bg-surface-inset hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
