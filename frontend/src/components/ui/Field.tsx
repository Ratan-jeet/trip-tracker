'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const control =
  'w-full rounded-xl border border-border bg-surface-base px-3.5 py-2.5 text-sm text-fg ' +
  'placeholder:text-fg-subtle transition-colors hover:border-border-strong ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

interface FieldWrapperProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldWrapperProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-fg">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(control, invalid && 'border-danger focus:border-danger focus:ring-danger/25', className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(control, 'resize-y', invalid && 'border-danger focus:border-danger', className)}
      {...rest}
    />
  );
});
