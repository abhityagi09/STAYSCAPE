import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ErrorState, Skeleton } from './Display';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export interface SortState {
  columnId: string;
  direction: 'asc' | 'desc';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  getRowId: (row: T) => string;
  caption: string;
  loading?: boolean;
  error?: { message?: string; requestId?: string | undefined } | null;
  onRetry?: () => void;
  empty?: ReactNode;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  skeletonRows?: number;
}

const align = { left: 'text-left', right: 'text-right', center: 'text-center' };

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  loading,
  error,
  onRetry,
  empty,
  sort,
  onSortChange,
  skeletonRows = 5,
}: DataTableProps<T>) {
  if (error)
    return <ErrorState description={error.message} requestId={error.requestId} onRetry={onRetry} />;

  return (
    // The scroll region is focusable so keyboard users can scroll wide tables.
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-2xl border border-border bg-surface"
    >
      <table
        className="w-full min-w-[640px] border-collapse text-sm"
        aria-busy={loading || undefined}
      >
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-muted/70">
          <tr>
            {columns.map((column) => {
              const active = sort?.columnId === column.id;
              const ariaSort = active
                ? sort?.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : column.sortable
                  ? 'none'
                  : undefined;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    'px-4 py-3 text-xs font-semibold tracking-wide text-fg-muted uppercase',
                    align[column.align ?? 'left'],
                    column.className,
                  )}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 uppercase hover:text-fg"
                      onClick={() =>
                        onSortChange({
                          columnId: column.id,
                          direction: active && sort?.direction === 'asc' ? 'desc' : 'asc',
                        })
                      }
                    >
                      {column.header}
                      {active ? (
                        sort?.direction === 'asc' ? (
                          <ArrowUp className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading &&
            Array.from({ length: skeletonRows }, (_, i) => (
              <tr key={`sk-${i}`}>
                {columns.map((column) => (
                  <td key={column.id} className="px-4 py-3.5">
                    <Skeleton className="h-4 w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading && rows?.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10">
                {empty ?? <p className="text-center text-fg-muted">No records found.</p>}
              </td>
            </tr>
          )}
          {!loading &&
            rows?.map((row) => (
              <tr key={getRowId(row)} className="transition-colors hover:bg-surface-muted/40">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      'px-4 py-3.5 align-middle text-fg',
                      align[column.align ?? 'left'],
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- Pagination */
function pageList(page: number, total: number): Array<number | 'gap'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, page, page - 1, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - (sorted[i - 1] ?? p) > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const btn =
    'inline-flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40';
  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-center gap-1', className)}
    >
      <button
        type="button"
        className={cn(btn, 'hover:bg-surface-muted')}
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      {pageList(page, totalPages).map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="px-1 text-fg-subtle" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
            className={cn(
              btn,
              p === page ? 'bg-primary font-semibold text-primary-fg' : 'hover:bg-surface-muted',
            )}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className={cn(btn, 'hover:bg-surface-muted')}
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </nav>
  );
}
