import { useCursorPagination, MAX_PAGE_SIZE, type CursorPage } from '@genesis/ui';

export interface LoanRow {
  id: string;
  loanRef: string;
  memberName: string;
  principal: string;
  outstanding: string;
  classification: 'normal' | 'watch' | 'substandard' | 'doubtful' | 'loss';
}

function fetchLoansPage(_cursor: string | null, _pageSize: number): Promise<CursorPage<LoanRow>> {
  // TODO(P10): replace with `apiClient.loans.list({ cursor, pageSize })`
  // once GET /loans ships (docs/BUILD_PROMPTS.md, P10) and the client is
  // regenerated.
  return Promise.reject('GET /loans is not implemented on the backend yet (see docs/BUILD_PROMPTS.md, P10).');
}

export function useLoanBook() {
  return useCursorPagination<LoanRow>({
    queryKey: ['loans'],
    fetchPage: fetchLoansPage,
    pageSize: MAX_PAGE_SIZE,
    enabled: false,
  });
}
