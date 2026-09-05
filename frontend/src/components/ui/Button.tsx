'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Spinner from './Spinner';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface text-fg border border-border hover:bg-surface-inset',
  ghost: 'text-fg-muted hover:bg-surface-inset hover:text-fg',
  danger: 'bg-danger text-white hover:bg-danger-hover shadow-sm',
  live: 'bg-live text-white hover:brightness-110 shadow-sm',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // A button that submits while already submitting double-creates trips.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
});

export default Button;
