'use client';

import { useState, type ReactNode } from 'react';
import { useQuery, keepPreviousData, type UseQueryOptions } from '@tanstack/react-query';
import type { CursorPage } from '@genesis/api-client';
import { colors, space, fontSize } from '@genesis/tokens';
import { Button } from './primitives';

/** Hard cap mirrors MASTER_PROMPT gate 1.3 ("hard max page size 100"). */
export const MAX_PAGE_SIZE = 100;

export type { CursorPage };

export interface UseCursorPaginationOptions<T> {
  /** React Query key prefix; the current cursor is appended automatically. */
  queryKey: readonly unknown[];
  /** Fetch one page. `cursor` is null for the first page. */
  fetchPage: (cursor: string | null, pageSize: number) => Promise<CursorPage<T>>;
  pageSize?: number;
  enabled?: boolean;
}

/**
 * Shared keyset-pagination state machine (gate 1.3). Forward-only cursors
 * are the contract with the API; "previous page" is supported by keeping a
 * stack of cursors we've already visited, since keyset pagination has no
 * `offset` to jump back to.
 */
export function useCursorPagination<T>({
  queryKey,
  fetchPage,
  pageSize = MAX_PAGE_SIZE,
  enabled = true,
}: UseCursorPaginationOptions<T>) {
  const effectivePageSize = Math.min(pageSize, MAX_PAGE_SIZE);
  // Stack of cursors that produced each page already seen; null = first page.
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const currentCursor = cursorStack[cursorStack.length - 1] ?? null;

  const query = useQuery({
    queryKey: [...queryKey, 'cursor', currentCursor, effectivePageSize],
    queryFn: () => fetchPage(currentCursor, effectivePageSize),
    placeholderData: keepPreviousData,
    enabled,
  } satisfies UseQueryOptions<CursorPage<T>>);

  const hasNextPage = Boolean(query.data?.nextCursor);
  const hasPrevPage = cursorStack.length > 1;

  function goNext() {
    const next = query.data?.nextCursor;
    if (next) setCursorStack((stack) => [...stack, next]);
  }

  function goPrev() {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack));
  }

  function reset() {
    setCursorStack([null]);
  }

  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    hasNextPage,
    hasPrevPage,
    pageIndex: cursorStack.length,
    goNext,
    goPrev,
    reset,
    refetch: query.refetch,
  };
}

export interface CursorTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

export interface CursorTableProps<T> {
  columns: Array<CursorTableColumn<T>>;
  rowKey: (row: T) => string;
  pagination: ReturnType<typeof useCursorPagination<T>>;
  emptyLabel?: string;
  caption: string;
}

/**
 * Presentational cursor-paginated table. Backs the members, loan book, and
 * ledger list views (MASTER_PROMPT acceptance criteria) — each page passes
 * its own columns + a `useCursorPagination` result pointed at its endpoint.
 */
export function CursorTable<T>({
  columns,
  rowKey,
  pagination,
  emptyLabel = 'No records found.',
  caption,
}: CursorTableProps<T>) {
  const { items, isLoading, isError, error, hasNextPage, hasPrevPage, goNext, goPrev, isFetching, pageIndex } =
    pagination;

  if (isError) {
    return (
      <div role="alert" style={{ color: colors.brick, padding: space[6] }}>
        Could not load {caption}: {error instanceof Error ? error.message : 'unknown error'}
      </div>
    );
  }

  return (
    <div>
      {/* Horizontal scroll on narrow viewports beats squeezing columns
          unreadably thin — the standard responsive pattern for data
          tables (the row/column relationship must stay intact). */}
      <div style={{ overflowX: 'auto' }}>
        <table
          aria-busy={isFetching}
          style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: fontSize.base }}
        >
          <caption className="gp-sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{
                    textAlign: col.align ?? 'left',
                    padding: space[5],
                    borderBottom: `1px solid ${colors.line}`,
                    color: colors.sub,
                    fontSize: fontSize.sm,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? (
                <tr>
                  <td colSpan={columns.length} style={{ padding: space[9], textAlign: 'center', color: colors.sub }}>
                    Loading…
                  </td>
                </tr>
              )
              : items.length === 0
                ? (
                  <tr>
                    <td colSpan={columns.length} style={{ padding: space[9], textAlign: 'center', color: colors.sub }}>
                      {emptyLabel}
                    </td>
                  </tr>
                )
                : (
                  items.map((row) => (
                    <tr key={rowKey(row)}>
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          style={{
                            textAlign: col.align ?? 'left',
                            padding: space[5],
                            borderBottom: `1px solid ${colors.line}`,
                          }}
                        >
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: space[5],
          marginTop: space[6],
        }}
      >
        {/* Visible + announced page position — so the user never has to
            count clicks to know where they are (recognition over recall). */}
        <span aria-live="polite" style={{ fontSize: fontSize.sm, color: colors.sub }}>
          Page {pageIndex}
        </span>
        <div style={{ display: 'flex', gap: space[4] }}>
          <Button variant="secondary" onClick={goPrev} disabled={!hasPrevPage || isFetching}>
            Previous
          </Button>
          <Button variant="secondary" onClick={goNext} disabled={!hasNextPage || isFetching}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
