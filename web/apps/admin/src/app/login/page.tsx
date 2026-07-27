'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { auth, ApiError } from '@genesis/api-client';
import { Button, Card, ErrorBanner } from '@genesis/ui';
import { colors, space, fontSize, radii } from '@genesis/tokens';
import { useAuth } from '@/lib/auth-context';

type Step = 'email' | 'code';

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
        background: colors.bg,
      }}
    >
      <Card style={{ padding: space[9], width: 360 }}>
        <h1 style={{ fontSize: fontSize['2xl'], color: colors.navy, marginTop: 0 }}>Genesis Prestige</h1>

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
            <label style={{ display: 'block', fontSize: fontSize.sm, color: colors.sub, marginBottom: space[2] }}>
              Work email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => { setEmail(e.target.value); }}
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
            <label style={{ display: 'block', fontSize: fontSize.sm, color: colors.sub, marginBottom: space[2] }}>
              6-digit code sent to {email}
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => { setCode(e.target.value); }}
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: `${space[4]} ${space[5]}`,
  borderRadius: radii.md,
  border: `1px solid ${colors.line}`,
  fontSize: fontSize.base,
  fontFamily: 'inherit',
};