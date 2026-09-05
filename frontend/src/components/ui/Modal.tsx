'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import IconButton from './IconButton';
import { cn } from './cn';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open?: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Set for destructive confirmations so a stray click outside cannot dismiss them. */
  dismissable?: boolean;
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

/**
 * Modals previously rendered inline with a hand-tuned z-index, no Escape handling, no
 * focus management and no way out for keyboard or screen-reader users. This one portals
 * to the body, traps focus, restores it on close and locks background scroll.
 */
export default function Modal({
  open = true,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissable = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissable) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [dismissable, onClose],
  );

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);

    // Focus the first control rather than dumping the user at the top of the document.
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? panelRef.current)?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={dismissable ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface shadow-lg',
          'rounded-t-3xl sm:rounded-2xl',
          'animate-fade-in-up',
          sizes[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-0.5 text-[13px] text-fg-muted">
                {description}
              </p>
            )}
          </div>
          {dismissable && (
            <IconButton
              label="Close"
              variant="ghost"
              size="sm"
              onClick={onClose}
              icon={
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              }
            />
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
