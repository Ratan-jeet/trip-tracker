import Link from 'next/link';

const FEATURES = [
  {
    title: 'Consent you control',
    body: 'Sharing starts only when you say so, and stops the moment you turn it off. Nothing is switched on for you.',
  },
  {
    title: 'One shared map',
    body: 'Everyone travelling together sees the same live view — people on phones, vehicles on trackers.',
  },
  {
    title: 'Data that expires',
    body: 'Positions are deleted automatically after 30 days, and you can erase your own history at any time.',
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold tracking-tight text-fg">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-accent-fg" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <circle cx="12" cy="10" r="2.5" fill="currentColor" />
            </svg>
          </span>
          Trip Tracker
        </span>
        <Link href="/login" className="text-sm font-medium text-fg-muted transition-colors hover:text-fg">
          Sign in
        </Link>
      </header>

      <div className="flex flex-1 flex-col justify-center py-16">
        <h1 className="max-w-2xl text-balance text-4xl font-bold leading-[1.1] tracking-tight text-fg sm:text-5xl">
          Everyone on one map, for as long as you choose.
        </h1>
        <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-fg-muted">
          Live location sharing for people travelling together — a road trip, a convoy, a group hike. Built so that
          turning it off is as easy as turning it on.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/register"
            className="inline-flex h-12 items-center rounded-xl bg-accent px-6 text-[15px] font-medium text-accent-fg shadow-sm transition-colors hover:bg-accent-hover"
          >
            Create an account
          </Link>
          <Link
            href="/login"
            className="inline-flex h-12 items-center rounded-xl border border-border bg-surface px-6 text-[15px] font-medium text-fg transition-colors hover:bg-surface-inset"
          >
            I already have one
          </Link>
        </div>

        <ul className="mt-16 grid gap-6 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <h2 className="text-sm font-semibold text-fg">{feature.title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{feature.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
