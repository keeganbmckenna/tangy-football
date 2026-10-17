'use client';

import type { ReactNode } from 'react';

/**
 * Header and cell classes for a table's first column, pinned while the table
 * scrolls sideways: tight padding on phones so it doesn't crowd the numbers
 * (globals.css draws the edge line).
 */
export const PIN_TH = 'pin-col sticky left-0 z-10 px-3 sm:px-6';
export const PIN_TD = 'pin-col sticky left-0 z-10 px-3 sm:px-6';

/** A team (or manager) in a pinned first column: truncated on phones, with its second line from sm up */
export default function TeamName({ name, sub, after }: { name: string; sub?: ReactNode; after?: ReactNode }) {
  return (
    <>
      <div className="max-w-[7.5rem] truncate text-sm font-medium text-[var(--foreground)] sm:max-w-none" title={name}>
        {name}
      </div>
      {sub && <div className="hidden text-xs text-[var(--muted)] sm:block">{sub}</div>}
      {after}
    </>
  );
}
