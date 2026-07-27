import { useCursorPagination, MAX_PAGE_SIZE, type CursorPage } from '@genesis/ui';

export interface LedgerRow {
  id: string;
  txnRef: string;
  postedAt: string;
  memberName: string;
  type: string;
  direction: 'DR' | 'CR';
  amount: string;
  channel: 'mpesa' | 'bank' | 'accrual';
}

function fetchLedgerPage(_cursor: string | null, _pageSize: number): Promise<CursorPage<LedgerRow>> {
  // TODO(P11): replace with `apiClient.ledger.list({ cursor, pageSize })`
  // once GET /ledger ships (docs/BUILD_PROMPTS.md, P11) and the client is
  // regenerated.
  return Promise.reject('GET /ledger is not implemented on the backend yet (see docs/BUILD_PROMPTS.md, P11).');
}

export function useLedger() {
  return useCursorPagination<LedgerRow>({
    queryKey: ['ledger'],
    fetchPage: fetchLedgerPage,
    pageSize: MAX_PAGE_SIZE,
    enabled: false,
  });
}
