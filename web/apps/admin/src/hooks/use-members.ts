import { useCursorPagination, MAX_PAGE_SIZE, type CursorPage } from '@genesis/ui';

/**
 * Shape the future `GET /members` list endpoint (build prompt P8) is
 * expected to return per row. Kept minimal and adjusted to match the
 * generated client the day that endpoint lands — nothing else in this file
 * (or in `@genesis/ui`'s pagination hook/table) needs to change then.
 */
export interface MemberRow {
  id: string;
  memberNo: string;
  name: string;
  type: 'person' | 'company' | 'group' | 'vehicle';
  status: 'active' | 'arrears' | 'exited';
}

function fetchMembersPage(_cursor: string | null, _pageSize: number): Promise<CursorPage<MemberRow>> {
  // TODO(P8): replace with `apiClient.members.list({ cursor, pageSize })`
  // once GET /members ships and the client is regenerated. Until then this
  // intentionally throws rather than returning fake data.
  return Promise.reject(
    new Error('GET /members is not implemented on the backend yet (see docs/BUILD_PROMPTS.md, P8).'),
  );
}

export function useMembers() {
  return useCursorPagination<MemberRow>({
    queryKey: ['members'],
    fetchPage: fetchMembersPage,
    pageSize: MAX_PAGE_SIZE,
    enabled: false, // flip to true once fetchMembersPage is wired to a real endpoint
  });
}
