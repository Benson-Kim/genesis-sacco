'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { me, type ModuleName } from '@genesis/api-client';
import { useAuth } from './auth-context';

type Action = 'view' | 'create' | 'edit' | 'approve';

const ACTION_FIELD: Record<Action, 'can_view' | 'can_create' | 'can_edit' | 'can_approve'> = {
  view: 'can_view',
  create: 'can_create',
  edit: 'can_edit',
  approve: 'can_approve',
};

/**
 * Fetches the caller's effective permission matrix once per session. This
 * ONLY drives client-side UI (hiding nav items, disabling buttons) — the API
 * re-checks every call server-side regardless (gate 1.6), so a stale or
 * tampered client value can never grant access it shouldn't.
 */
export function usePermissions() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: () => me.getPermissions(),
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });
}

export function usePermission(module: ModuleName, action: Action): boolean {
  const { data } = usePermissions();
  const grant = data?.permissions.find((p) => p.module === module);
  return grant ? grant[ACTION_FIELD[action]] : false;
}

/**
 * Wraps a route segment: redirects to /login if unauthenticated, and to the
 * dashboard root if the caller lacks `view` on the required module. Nothing
 * here is a security boundary by itself — see the note on usePermissions.
 */
export function RouteGuard({
  module,
  children,
}: {
  module: ModuleName;
  children: ReactNode;
}) {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const { data, isLoading } = usePermissions();
  const allowed = usePermission(module, 'view');

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (!isLoading && data && !allowed) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, data, allowed, router]);

  if (!isAuthenticated || isLoading || !allowed) return null;
  return <>{children}</>;
}
