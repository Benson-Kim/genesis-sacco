'use client';

import type { UserOut } from '@genesis/api-client';
import { Button, EmptyState, ErrorBanner } from '@genesis/ui';
import { colors, space } from '@genesis/tokens';
import { usePermission } from '@/lib/permissions';
import { useUsers } from '@/hooks/use-users';
import { initials, relativeTime, capitalize } from './constants';

function UserAvatar({ name }: { name: string }) {
  return (
    <span className="ac-avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function UserRow({ user }: { user: UserOut }) {
  return (
    <tr>
      <td>
        <div className="ac-user-cell">
          <UserAvatar name={user.full_name} />
          <span className="ac-user-name">{user.full_name}</span>
        </div>
      </td>
      <td>
        <span className="ac-role-pill">{user.role_name}</span>
      </td>
      <td style={{ color: colors.sub }}>{user.branch ?? '—'}</td>
      <td style={{ color: colors.sub }}>{relativeTime(user.last_active)}</td>
      <td style={{ textAlign: 'right' }}>
        <span
          className="ac-status-pill"
          data-status={user.status}
          aria-label={`Status: ${capitalize(user.status)}`}
        >
          {capitalize(user.status)}
        </span>
      </td>
    </tr>
  );
}

function UsersTable({ users }: { users: UserOut[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ac-users-table">
        <caption style={{ position: 'absolute', left: -9999 }}>Staff users</caption>
        <thead>
          <tr>
            <th scope="col">User</th>
            <th scope="col">Role</th>
            <th scope="col">Branch</th>
            <th scope="col">Last active</th>
            <th scope="col" style={{ textAlign: 'right' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow key={user.id} user={user} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsersPanel() {
  const canCreate = usePermission('access_control', 'create');
  const { data: users, isLoading, isError, error } = useUsers();

  if (isLoading) return <EmptyState label="Loading users…" />;
  if (isError) {
    return (
      <ErrorBanner
        message={error instanceof Error ? error.message : 'Could not load users. Please try again.'}
      />
    );
  }

  const list = users ?? [];
  if (list.length === 0) return <EmptyState label="No staff users found." />;

  return (
    <>
      {canCreate && (
        <div className="ac-users-toolbar">
          <Button
            variant="primary"
            aria-label="Add a new user"
            style={{ display: 'flex', alignItems: 'center', gap: space[2] }}
          >
            + Add user
          </Button>
        </div>
      )}
      <UsersTable users={list} />
    </>
  );
}
