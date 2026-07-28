'use client';

import { PageHeader, CursorTable, StatusPill, type CursorTableColumn } from '@genesis/ui';
import { RouteGuard } from '@/lib/permissions';
import { useLoanBook, type LoanRow } from '@/hooks/use-loan-book';

const CLASSIFICATION_TONE = {
  normal: 'good',
  watch: 'watch',
  substandard: 'watch',
  doubtful: 'bad',
  loss: 'loss',
} as const;

const columns: Array<CursorTableColumn<LoanRow>> = [
  { key: 'loanRef', header: 'Loan ref.', render: (r) => r.loanRef },
  { key: 'memberName', header: 'Member', render: (r) => r.memberName },
  { key: 'principal', header: 'Principal', render: (r) => r.principal, align: 'right' },
  { key: 'outstanding', header: 'Outstanding', render: (r) => r.outstanding, align: 'right' },
  {
    key: 'classification',
    header: 'Classification',
    render: (r) => <StatusPill tone={CLASSIFICATION_TONE[r.classification]}>{r.classification}</StatusPill>,
  },
];

function LoanBookContent() {
  const pagination = useLoanBook();
  return (
    <div>
      <PageHeader title="Loan book" />
      <CursorTable columns={columns} rowKey={(r) => r.id} pagination={pagination} caption="Loan book" />
    </div>
  );
}

export default function LoanBookPage() {
  return (
    <RouteGuard module="loan_book">
      <LoanBookContent />
    </RouteGuard>
  );
}
