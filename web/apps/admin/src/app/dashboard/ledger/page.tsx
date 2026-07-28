'use client';

import { PageHeader, CursorTable, type CursorTableColumn } from '@genesis/ui';
import { RouteGuard } from '@/lib/permissions';
import { useLedger, type LedgerRow } from '@/hooks/use-ledger';

const columns: Array<CursorTableColumn<LedgerRow>> = [
  { key: 'postedAt', header: 'Date', render: (r) => r.postedAt },
  { key: 'txnRef', header: 'Ref.', render: (r) => r.txnRef },
  { key: 'memberName', header: 'Member', render: (r) => r.memberName },
  { key: 'type', header: 'Type', render: (r) => r.type },
  { key: 'direction', header: 'DR/CR', render: (r) => r.direction },
  { key: 'amount', header: 'Amount', render: (r) => r.amount, align: 'right' },
  { key: 'channel', header: 'Channel', render: (r) => r.channel },
];

function LedgerContent() {
  const pagination = useLedger();
  return (
    <div>
      <PageHeader title="Ledger" />
      <CursorTable columns={columns} rowKey={(r) => r.id} pagination={pagination} caption="Ledger" />
    </div>
  );
}

export default function LedgerPage() {
  return (
    <RouteGuard module="transactions">
      <LedgerContent />
    </RouteGuard>
  );
}
