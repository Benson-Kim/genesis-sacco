import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CursorTable, useCursorPagination, type CursorPage } from './CursorTable';

interface Row {
  id: string;
  name: string;
}

function wrapper(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function TestTable({ fetchPage }: { fetchPage: (cursor: string | null, pageSize: number) => Promise<CursorPage<Row>> }) {
  const pagination = useCursorPagination<Row>({ queryKey: ['test'], fetchPage });
  return (
    <CursorTable
      caption="test rows"
      rowKey={(r) => r.id}
      pagination={pagination}
      columns={[{ key: 'name', header: 'Name', render: (r) => r.name }]}
    />
  );
}

describe('CursorTable + useCursorPagination', () => {
  it('renders the first page and paginates forward/back via cursors', async () => {
    const fetchPage = vi.fn(async (cursor: string | null): Promise<CursorPage<Row>> => {
      if (cursor === null) return { items: [{ id: '1', name: 'Alice' }], nextCursor: 'c2' };
      if (cursor === 'c2') return { items: [{ id: '2', name: 'Bob' }], nextCursor: null };
      throw new Error('unexpected cursor');
    });

    render(wrapper(<TestTable fetchPage={fetchPage} />));

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText('Next')).not.toBeDisabled();
    expect(screen.getByText('Previous')).toBeDisabled();

    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
    expect(screen.getByText('Next')).toBeDisabled();

    fireEvent.click(screen.getByText('Previous'));
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    expect(fetchPage).toHaveBeenCalledWith(null, 100);
    expect(fetchPage).toHaveBeenCalledWith('c2', 100);
  });

  it('shows an empty state when a page has no rows', async () => {
    const fetchPage = vi.fn(async (): Promise<CursorPage<Row>> => ({ items: [], nextCursor: null }));
    render(wrapper(<TestTable fetchPage={fetchPage} />));
    await waitFor(() => expect(screen.getByText('No records found.')).toBeInTheDocument());
  });
});
