import Link from 'next/link';
import type { ReactNode } from 'react';
import ThemeToggle from './ThemeToggle';

export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col px-5 py-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-fg">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-accent-fg" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <circle cx="12" cy="10" r="2.5" fill="currentColor" />
            </svg>
          </span>
          Trip Tracker
        </Link>
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
          <p className="mt-1.5 text-sm text-fg-muted">{subtitle}</p>
          <div className="mt-7">{children}</div>
          <div className="mt-6 text-center text-[13px] text-fg-muted">{footer}</div>
        </div>
      </div>
    </main>
  );
}
