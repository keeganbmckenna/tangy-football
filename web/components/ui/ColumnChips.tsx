'use client';

import type { ColumnPicker } from '@/hooks/useColumnPicker';

/** A phone's row of column toggles above a table (useColumnPicker); wider screens don't show it */
export default function ColumnChips({ picker }: { picker: ColumnPicker }) {
  if (!picker.columns.length) return null;
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-4 pt-3 pb-1 sm:hidden" role="group" aria-label="Columns shown">
      <span className="mr-1 shrink-0 text-xs text-[var(--muted)]">Columns</span>
      {picker.columns.map((c) => {
        const on = picker.isShown(c.key);
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => picker.toggle(c.key)}
            aria-pressed={on}
            className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              on ? 'border-transparent bg-[var(--info-bg)] text-[var(--info-text)]' : 'border-[var(--border)] text-[var(--muted)]'
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
