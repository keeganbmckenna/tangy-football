'use client';

import { useState, type ReactNode } from 'react';

/** The first `initial` items (all of them once asked), with a "Show all (n)" button when there are more */
export default function Capped<T>({ items, initial, children, className = '' }: { items: T[]; initial: number; children: (shown: T[]) => ReactNode; className?: string }) {
  const [all, setAll] = useState(false);
  const shown = all || items.length <= initial ? items : items.slice(0, initial);
  return (
    <>
      {children(shown)}
      {items.length > initial && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className={`mt-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)] ${className}`}
        >
          {all ? 'Show fewer' : `Show all (${items.length})`}
        </button>
      )}
    </>
  );
}
