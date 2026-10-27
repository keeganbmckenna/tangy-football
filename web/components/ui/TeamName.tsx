'use client';

import type { ReactNode } from 'react';

/**
 * Header and cell classes for a table's first column, pinned while the table
 * scrolls sideways: tight padding on phones so it doesn't crowd the numbers
 * (globals.css draws the edge line).
 */
export const PIN_TH = 'pin-col sticky left-0 z-10 px-3 sm:px-6';
export const PIN_TD = 'pin-col sticky left-0 z-10 px-3 sm:px-6';
/** A column left out on phones, where it would push the table into scrolling sideways */
export const WIDE_ONLY = 'hidden sm:table-cell';

/** A team in a pinned first column, with its manager (or other detail) under it; both truncated on phones */
export default function TeamName({ name, sub, after }: { name: string; sub?: string; after?: ReactNode }) {
  return (
    <>
      <div className="max-w-[6.5rem] truncate text-sm font-medium text-[var(--foreground)] sm:max-w-none" title={name}>
        {name}
      </div>
      {sub && (
        <div className="max-w-[6.5rem] truncate text-xs text-[var(--muted)] sm:max-w-none" title={sub}>
          {sub}
        </div>
      )}
      {after}
    </>
  );
}
