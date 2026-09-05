'use client';

import { useEffect, useState } from 'react';
import IconButton from './ui/IconButton';

type Theme = 'light' | 'dark' | 'system';
const KEY = 'trip-tracker.theme';

export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY);
      if (stored === 'dark' || stored === 'light') setTheme(stored);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    try {
      if (next === 'system') {
        window.localStorage.removeItem(KEY);
        document.documentElement.removeAttribute('data-theme');
      } else {
        window.localStorage.setItem(KEY, next);
        document.documentElement.setAttribute('data-theme', next);
      }
    } catch {
      /* storage unavailable */
    }
  };

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <IconButton
      className={className}
      variant="ghost"
      size="sm"
      label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => apply(isDark ? 'light' : 'dark')}
      icon={
        isDark ? (
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        )
      }
    />
  );
}
