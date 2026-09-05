'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { cn } from './cn';

type ToastTone = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Replaces window.alert(), which blocks the page and cannot be styled or dismissed. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const tones: Record<ToastTone, { cls: string; icon: ReactNode }> = {
  info: {
    cls: 'border-border bg-surface text-fg',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-accent">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 11v5M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  success: {
    cls: 'border-live/30 bg-live-soft text-fg',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-live">
        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  error: {
    cls: 'border-danger/30 bg-danger-soft text-fg',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-danger">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v6M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message, 'error'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            // Announced to screen readers without stealing focus.
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-0 z-[3000] flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={cn(
                  'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-lg animate-fade-in-up',
                  tones[toast.tone].cls,
                )}
              >
                <span className="mt-px shrink-0">{tones[toast.tone].icon}</span>
                <p className="text-[13px] leading-snug">{toast.message}</p>
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
                  className="-mr-1 ml-auto shrink-0 rounded p-0.5 text-fg-subtle hover:text-fg"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
