/**
 * The keyset-pagination response shape every list endpoint must return
 * (MASTER_PROMPT gate 1.3: "keyset (cursor) pagination on all list
 * endpoints"). Defined once here; `@genesis/ui`'s `useCursorPagination` /
 * `CursorTable` consume it generically so every paginated table (members,
 * loan book, ledger, ...) shares one implementation.
 */
export interface CursorPage<T> {
  items: T[];
  /** Present when another page follows; null/absent on the last page. */
  nextCursor: string | null;
}
