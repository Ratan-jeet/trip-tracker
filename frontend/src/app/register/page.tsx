'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import AuthShell from '@/components/AuthShell';
import Button from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';

export default function RegisterPage() {
  const router = useRouter();
  const register = useStore((s) => s.register);
  const token = useStore((s) => s.token);
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  useEffect(() => {
    if (hydrated && token) router.replace('/dashboard');
  }, [hydrated, token, router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await register(email, password, displayName, phone || undefined);
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        // Surface per-field messages instead of one opaque banner.
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not create your account');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="You choose when to share your location — never by default."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" required error={fieldErrors.displayName}>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              maxLength={100}
              required
              autoFocus
            />
          )}
        </Field>

        <Field label="Email" required error={fieldErrors.email}>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          )}
        </Field>

        <Field label="Password" required hint="At least 8 characters." error={fieldErrors.password}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          )}
        </Field>

        <Field label="Phone" hint="Optional — helps your group recognise you." error={fieldErrors.phone}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              maxLength={20}
            />
          )}
        </Field>

        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}

        <Button type="submit" fullWidth size="lg" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
