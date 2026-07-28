import { useCursorPagination, MAX_PAGE_SIZE, type CursorPage } from '@genesis/ui';

/** Contract shape for the future backend `GET /members` endpoint (build prompt P8). */
export interface MemberRow {
  id: string;
  memberNo: string;
  name: string;
  type: 'person' | 'company' | 'group' | 'vehicle';
  status: 'active' | 'arrears' | 'exited';
}

function fetchMembersPage(_cursor: string | null, _pageSize: number): Promise<CursorPage<MemberRow>> {
  return Promise.reject(new Error('GET /members is not implemented on the backend yet (see docs/BUILD_PROMPTS.md, P8).'));
}

export function useMembers() {
  return useCursorPagination<MemberRow>({
    queryKey: ['members'],
    fetchPage: fetchMembersPage,
    pageSize: MAX_PAGE_SIZE,
    enabled: false,
  });
}
