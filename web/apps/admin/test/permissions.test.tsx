import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as apiClient from '@genesis/api-client';
import { usePermission } from '@/lib/permissions';

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, accessToken: 'token', setTokens: vi.fn(), clearSession: vi.fn() }),
}));

function Probe() {
  const canView = usePermission('members', 'view');
  const canApprove = usePermission('members', 'approve');
  return (
    <div>
      <span>view:{String(canView)}</span>
      <span>approve:{String(canApprove)}</span>
    </div>
  );
}

describe('usePermission', () => {
  it('reflects the grant returned by /me/permissions and denies anything absent', async () => {
    vi.spyOn(apiClient.me, 'getPermissions').mockResolvedValue({
      role_id: 'role-1',
      permissions: [{ module: 'members', can_view: true, can_create: false, can_edit: false, can_approve: false }],
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText('view:true')).toBeInTheDocument());
    expect(screen.getByText('approve:false')).toBeInTheDocument();
  });
});
