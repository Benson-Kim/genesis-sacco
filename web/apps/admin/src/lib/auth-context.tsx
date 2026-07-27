'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { configureHttpClient, auth, type AuthTokens } from '@genesis/api-client';

const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? '';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const STORAGE_KEY = 'gp.refresh_token';

interface AuthContextValue {
  isAuthenticated: boolean;
  accessToken: string | null;
  setTokens: (tokens: AuthTokens) => void;
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [tokens, setTokensState] = useState<AuthTokens | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const setTokens = useCallback((next: AuthTokens) => {
    setTokensState(next);
    // Only the refresh token persists across reloads; the short-lived access
    // token stays in memory only (reduces XSS blast radius, gate 1.6).
    window.localStorage.setItem(STORAGE_KEY, next.refreshToken);
  }, []);

  const clearSession = useCallback(() => {
    setTokensState(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    configureHttpClient({
      baseUrl: API_BASE_URL,
      tenantId: TENANT_ID,
      getTokens: () => tokens,
      onTokensRefreshed: setTokens,
      onSessionExpired: clearSession,
    });
  }, [tokens, setTokens, clearSession]);

  // On mount, attempt a silent refresh from the stored refresh token so a
  // reload doesn't force a fresh OTP round-trip.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setHydrated(true);
      return;
    }
    const refreshToken: string = stored;

    async function silentRefresh() {
      try {
        const pair = await auth.refresh(refreshToken);
        setTokens({ accessToken: pair.access_token, refreshToken: pair.refresh_token });
      } catch {
        clearSession();
      } finally {
        setHydrated(true);
      }
    }

    void silentRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: tokens !== null,
      accessToken: tokens?.accessToken ?? null,
      setTokens,
      clearSession,
    }),
    [tokens, setTokens, clearSession],
  );

  if (!hydrated) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used within <AuthProvider>');
  return ctx;
}