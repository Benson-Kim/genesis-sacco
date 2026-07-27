'use client';

import { PageHeader, CursorTable, StatusPill, type CursorTableColumn } from '@genesis/ui';
import { RouteGuard } from '@/lib/permissions';
import { useMembers, type MemberRow } from '@/hooks/use-members';

const columns: Array<CursorTableColumn<MemberRow>> = [
  { key: 'memberNo', header: 'Member No.', render: (r) => r.memberNo },
  { key: 'name', header: 'Name', render: (r) => r.name },
  { key: 'type', header: 'Type', render: (r) => r.type },
  {
    key: 'status',
    header: 'Status',
    render: (r) => (
      <StatusPill tone={r.status === 'active' ? 'good' : r.status === 'arrears' ? 'watch' : 'neutral'}>
        {r.status}
      </StatusPill>
    ),
  },
];

function MembersContent() {
  const pagination = useMembers();
  return (
    <div>
      <PageHeader title="Members" />
      <CursorTable columns={columns} rowKey={(r) => r.id} pagination={pagination} caption="Members" />
    </div>
  );
}

export default function MembersPage() {
  return (
    <RouteGuard module="members">
      <MembersContent />
    </RouteGuard>
  );
}
