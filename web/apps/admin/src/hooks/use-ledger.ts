import { useCursorPagination, MAX_PAGE_SIZE, type CursorPage } from '@genesis/ui';

/** Contract shape for the future backend `GET /ledger` endpoint (build prompt P11). */
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
  return Promise.reject(new Error('GET /ledger is not implemented on the backend yet (see docs/BUILD_PROMPTS.md, P11).'));
}

export function useLedger() {
  return useCursorPagination<LedgerRow>({
    queryKey: ['ledger'],
    fetchPage: fetchLedgerPage,
    pageSize: MAX_PAGE_SIZE,
    enabled: false,
  });
}
