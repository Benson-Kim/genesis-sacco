'use client';

import { Card, MetricCard, PageHeader, StatusPill } from '@genesis/ui';
import { colors, fontSize, space } from '@genesis/tokens';
import { usePermissions } from '@/lib/permissions';
import { useRoles } from '@/hooks/use-roles';

export default function DashboardHomePage() {
  const permissions = usePermissions();
  const roles = useRoles();
  const grants = permissions.data?.permissions ?? [];
  const visibleModules = grants.filter((grant) => grant.can_view).length;
  const approvalModules = grants.filter((grant) => grant.can_approve).length;

  return (
    <div>
      <PageHeader title="Portfolio overview" eyebrow="Backend-driven workspace" />
      <div style={{ display: 'grid', gap: space[7], gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <MetricCard label="Visible modules" value={permissions.isLoading ? '…' : visibleModules} detail="Resolved from /me/permissions" />
        <MetricCard label="Approval grants" value={permissions.isLoading ? '…' : approvalModules} detail="Deny-by-default RBAC" />
        <MetricCard label="System roles" value={roles.isLoading ? '…' : (roles.data?.filter((role) => role.is_system).length ?? 0)} detail="Loaded from /access/roles" />
        <MetricCard label="Data source" value="API" detail="No fabricated SACCO records" />
      </div>

      <div style={{ display: 'grid', gap: space[7], gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, .8fr)', marginTop: space[7] }}>
        <Card>
          <h2 style={{ fontSize: fontSize.lg, marginTop: 0 }}>Your effective permissions</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.base }}>
              <thead>
                <tr style={{ background: colors.panel }}>
                  {['Module', 'View', 'Create', 'Edit', 'Approve'].map((head) => (
                    <th key={head} style={{ textAlign: 'left', padding: space[5], color: colors.sub }}>{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grants.map((grant) => (
                  <tr key={grant.module}>
                    <td style={{ padding: space[5], borderBottom: `1px solid ${colors.panel}`, fontWeight: 800 }}>{grant.module}</td>
                    <td style={{ padding: space[5], borderBottom: `1px solid ${colors.panel}` }}><StatusPill tone={grant.can_view ? 'good' : 'neutral'}>{String(grant.can_view)}</StatusPill></td>
                    <td style={{ padding: space[5], borderBottom: `1px solid ${colors.panel}` }}><StatusPill tone={grant.can_create ? 'good' : 'neutral'}>{String(grant.can_create)}</StatusPill></td>
                    <td style={{ padding: space[5], borderBottom: `1px solid ${colors.panel}` }}><StatusPill tone={grant.can_edit ? 'good' : 'neutral'}>{String(grant.can_edit)}</StatusPill></td>
                    <td style={{ padding: space[5], borderBottom: `1px solid ${colors.panel}` }}><StatusPill tone={grant.can_approve ? 'good' : 'neutral'}>{String(grant.can_approve)}</StatusPill></td>
                  </tr>
                ))}
                {!permissions.isLoading && grants.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: space[9], textAlign: 'center', color: colors.sub }}>No permission grants returned by the backend.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card tone="hero">
          <div style={{ color: colors.goldSoft, fontSize: fontSize.sm, fontWeight: 700 }}>Prototype fidelity guardrail</div>
          <div style={{ fontSize: fontSize['3xl'], fontWeight: 800, marginTop: space[2] }}>Secure first</div>
          <p style={{ color: colors.goldSoft, lineHeight: 1.6 }}>
            Views render backend contracts only. Pending modules show explicit unavailable states rather than mock balances,
            loan totals, or member PII.
          </p>
        </Card>
      </div>
    </div>
  );
}
