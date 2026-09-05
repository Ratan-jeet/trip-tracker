'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only controls previously shipped with no accessible name at all. */
  label: string;
  icon: ReactNode;
  variant?: 'surface' | 'ghost' | 'accent';
  size?: 'sm' | 'md' | 'lg';
}

const variants = {
  surface: 'bg-surface border border-border text-fg shadow-md hover:bg-surface-inset',
  ghost: 'text-fg-muted hover:bg-surface-inset hover:text-fg',
  accent: 'bg-accent text-accent-fg shadow-md hover:bg-accent-hover',
};

const sizes = { sm: 'h-8 w-8 rounded-lg', md: 'h-10 w-10 rounded-xl', lg: 'h-12 w-12 rounded-2xl' };

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'surface', size = 'md', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});

export default IconButton;
