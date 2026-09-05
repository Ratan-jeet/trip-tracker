'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { useStore } from '@/lib/store';
import AuthShell from '@/components/AuthShell';
import Button from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';

export default function LoginPage() {
  const router = useRouter();
  const login = useStore((s) => s.login);
  const token = useStore((s) => s.token);
  const hydrate = useStore((s) => s.hydrate);
  const hydrated = useStore((s) => s.hydrated);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    try {
      const signedIn = await login(
        email,
        password,
        needsTwoFactor
          ? useRecovery
            ? { recoveryCode: twoFactorCode }
            : { twoFactorCode }
          : undefined,
      );
      if (!signedIn) {
        setNeedsTwoFactor(true);
        return;
      }
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see where your group is."
      footer={
        <>
          New here?{' '}
          <Link href="/register" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" required>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              disabled={needsTwoFactor}
              autoFocus
            />
          )}
        </Field>

        <Field label="Password" required>
          {({ id }) => (
            <Input
              id={id}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={needsTwoFactor}
            />
          )}
        </Field>

        {needsTwoFactor && (
          <Field
            label={useRecovery ? 'Recovery code' : 'Authentication code'}
            required
            hint={useRecovery ? 'One of the codes you saved when you turned on two-factor.' : 'From your authenticator app.'}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                placeholder={useRecovery ? 'XXXXX-XXXXX' : '000000'}
                className="text-center text-lg tracking-[0.25em] tabular"
                autoFocus
                required
              />
            )}
          </Field>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}

        <Button type="submit" fullWidth size="lg" loading={busy}>
          {needsTwoFactor ? 'Verify and sign in' : 'Sign in'}
        </Button>

        {needsTwoFactor && (
          <button
            type="button"
            onClick={() => {
              setUseRecovery((v) => !v);
              setTwoFactorCode('');
            }}
            className="w-full text-center text-[13px] text-fg-muted hover:text-fg"
          >
            {useRecovery ? 'Use an authenticator code instead' : 'Lost your device? Use a recovery code'}
          </button>
        )}
      </form>
    </AuthShell>
  );
}
