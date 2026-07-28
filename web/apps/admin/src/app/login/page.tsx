'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { auth, ApiError } from '@genesis/api-client';
import { Button, Card, ErrorBanner } from '@genesis/ui';
import { colors, space, fontSize, radii } from '@genesis/tokens';
import { useAuth } from '@/lib/auth-context';

type Step = 'email' | 'code';
const STEP_NUMBER: Record<Step, number> = { email: 1, code: 2 };
const TOTAL_STEPS = 2;

export default function LoginPage() {
  const router = useRouter();
  const { setTokens } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const requestOtp = useMutation({
    mutationFn: () => auth.requestOtp(email),
    onSuccess: () => {
      setStep('code');
    },
  });

  const verifyOtp = useMutation({
    mutationFn: () => auth.verifyOtp(email, code),
    onSuccess: (pair) => {
      setTokens({ accessToken: pair.access_token, refreshToken: pair.refresh_token });
      router.replace('/dashboard');
    },
  });

  const pendingError = requestOtp.error ?? verifyOtp.error;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: space[6],
        background: colors.bg,
      }}
    >
      <Card style={{ padding: space[9], width: '100%', maxWidth: 360 }}>
        <h1 style={{ fontSize: fontSize['2xl'], color: colors.navy, marginTop: 0, marginBottom: space[2] }}>
          Genesis Prestige
        </h1>
        {/* Visible progress + a polite live region: sighted users see the
            step change, screen-reader users hear it announced once,
            without duplicating every keystroke. */}
        <p aria-live="polite" style={{ fontSize: fontSize.sm, color: colors.sub, marginTop: 0, marginBottom: space[7] }}>
          Step {STEP_NUMBER[step]} of {TOTAL_STEPS}
        </p>

        {pendingError && (
          <ErrorBanner
            message={
              pendingError instanceof ApiError
                ? describeAuthError(pendingError)
                : 'Something went wrong. Please try again.'
            }
          />
        )}

        {step === 'email' ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              requestOtp.mutate();
            }}
          >
            <label htmlFor="email" style={labelStyle}>
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              style={inputStyle}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={requestOtp.isPending}
              style={{ width: '100%', marginTop: space[6] }}
            >
              {requestOtp.isPending ? 'Sending code…' : 'Send code'}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyOtp.mutate();
            }}
          >
            <label htmlFor="otp-code" style={labelStyle}>
              6-digit code sent to {email}
            </label>
            <input
              id="otp-code"
              name="otp"
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
              }}
              style={inputStyle}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={verifyOtp.isPending}
              style={{ width: '100%', marginTop: space[6] }}
            >
              {verifyOtp.isPending ? 'Verifying…' : 'Verify'}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}

function describeAuthError(err: ApiError): string {
  if (err.status === 429) return 'Too many attempts — please wait a few minutes and try again.';
  if (err.status === 401) return 'That code is incorrect or has expired.';
  return 'Could not sign in right now. Please try again shortly.';
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: fontSize.sm,
  color: colors.sub,
  marginBottom: space[2],
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 44, // touch target (Fitts's law), matches Button
  padding: `${space[4]} ${space[5]}`,
  borderRadius: radii.md,
  border: `1px solid ${colors.line}`,
  // 16px, not the design system's 13px base size: anything smaller makes
  // iOS Safari auto-zoom the page on focus, which is jarring on a login
  // form users hit on their phone first.
  fontSize: 16,
  fontFamily: 'inherit',
};
