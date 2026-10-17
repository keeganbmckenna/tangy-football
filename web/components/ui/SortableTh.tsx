'use client';

import type { ReactNode } from 'react';
import type { TableSort } from '@/hooks/useTableSort';
import type { SortDir } from '@/lib/tableSort';
import { TermTip } from '@/components/ui/Term';

interface SortableThProps {
  sort: TableSort;
  col: string;
  /** Which way is best-first, the first click's order (default: high to low) */
  best?: SortDir;
  /** Column name for "Sorted by ..." (defaults to the header text) */
  label?: string;
  className?: string;
  title?: string;
  /** What the column means, shown on hover or focus */
  tip?: ReactNode;
  tipAlign?: 'center' | 'left' | 'right';
  children: ReactNode;
}

/** A table header that sorts its column: best-first, then reversed, then the table's own order */
export default function SortableTh({ sort, col, best = 'desc', label, className = '', title, tip, tipAlign, children }: SortableThProps) {
  const active = sort.state?.key === col ? sort.state.dir : null;
  const name = label ?? (typeof children === 'string' ? children : col);
  return (
    <th
      className={tip ? `${className} group/term relative` : className}
      title={title}
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        onClick={() => sort.toggle(col, best, name)}
        className={`inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-[var(--foreground)] ${
          active ? 'text-[var(--foreground)]' : ''
        }`}
      >
        {tip ? <span className="underline decoration-dotted decoration-from-font underline-offset-2">{children}</span> : children}
        <span aria-hidden className={`text-[9px] ${active ? '' : 'opacity-30'}`}>
          {active === 'asc' ? '▲' : active === 'desc' ? '▼' : '↕'}
        </span>
      </button>
      {tip && <TermTip tip={tip} align={tipAlign} />}
    </th>
  );
}

/**
 * The line above a sortable table: a hint while it's in its own order, then
 * "Sorted by X · Default order". Always the same height, so sorting never
 * moves anything below it.
 */
export function SortStatus({ sort, className = 'px-4 sm:px-6' }: { sort: TableSort; className?: string }) {
  return (
    <div className={`flex h-9 items-center justify-end gap-2 overflow-hidden whitespace-nowrap text-xs text-[var(--muted)] ${className}`}>
      {sort.state ? (
        <>
          <span className="truncate">
            Sorted by <span className="font-medium text-[var(--foreground)]">{sort.state.label}</span>{' '}
            ({sort.state.dir === 'desc' ? 'high to low' : 'low to high'})
          </span>
          <button
            type="button"
            onClick={sort.reset}
            className="shrink-0 rounded-full border border-[var(--border)] px-2.5 py-0.5 font-medium text-[var(--foreground)] hover:bg-[var(--hover)]"
          >
            ↺ Default order
          </button>
        </>
      ) : (
        <span className="opacity-70">Tap a column header to sort</span>
      )}
    </div>
  );
}
