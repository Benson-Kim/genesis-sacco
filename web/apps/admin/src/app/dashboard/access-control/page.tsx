'use client';

import { PageHeader, Card, EmptyState } from '@genesis/ui';
import { space, colors, fontSize } from '@genesis/tokens';
import { RouteGuard } from '@/lib/permissions';
import { useRoles } from '@/hooks/use-roles';

function AccessControlContent() {
  const { data: roles, isLoading, isError } = useRoles();

  return (
    <div>
      <PageHeader title="Access control" />
      <Card style={{ padding: space[8] }}>
        {isLoading && <EmptyState label="Loading roles…" />}
        {isError && <EmptyState label="Could not load roles." />}
        {roles && roles.length === 0 && <EmptyState label="No roles configured for this tenant." />}
        {roles && roles.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 320, borderCollapse: 'collapse', fontSize: fontSize.base }}>
              <caption className="gp-sr-only">Roles</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    style={{ textAlign: 'left', padding: space[5], color: colors.sub, borderBottom: `1px solid ${colors.line}` }}
                  >
                    Role
                  </th>
                  <th
                    scope="col"
                    style={{ textAlign: 'left', padding: space[5], color: colors.sub, borderBottom: `1px solid ${colors.line}` }}
                  >
                    Type
                  </th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td style={{ padding: space[5], borderBottom: `1px solid ${colors.line}` }}>{role.name}</td>
                    <td style={{ padding: space[5], borderBottom: `1px solid ${colors.line}` }}>
                      {role.is_system ? 'System' : 'Custom'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function AccessControlPage() {
  return (
    <RouteGuard module="access_control">
      <AccessControlContent />
    </RouteGuard>
  );
}
