'use client';

import { useState } from 'react';

export interface PickableColumn {
  key: string;
  /** Chip text */
  label: string;
  /** Shown on a phone until the viewer removes it (otherwise only once they add it) */
  phoneDefault?: boolean;
  /** Width from which the column shows anyway (default sm) */
  from?: 'sm' | 'md' | 'lg';
}

// Whole class names, so Tailwind finds them
const WIDE_FROM = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' } as const;

export interface ColumnPicker {
  columns: PickableColumn[];
  /** Picked by the viewer (or a default they haven't removed) */
  isShown: (key: string) => boolean;
  toggle: (key: string) => void;
  /** The column's visibility classes: always shown if picked or sorted by, else from its width */
  col: (key: string) => string;
}

const storageKey = (id: string) => `tangy-football:${id}-columns`;

function read(id: string, columns: PickableColumn[]): string[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey(id)) ?? 'null');
    if (Array.isArray(saved)) return saved.filter((k) => columns.some((c) => c.key === k));
  } catch {
    // Not remembered (private browsing, or rendered on the server): the defaults
  }
  return columns.filter((c) => c.phoneDefault).map((c) => c.key);
}

/**
 * Which of a table's columns a phone shows: the viewer picks them (ColumnChips), remembered per
 * device under `id`, and the column the table is sorted by always shows. Wider screens show
 * each column from its own width as before.
 */
export function useColumnPicker(id: string, columns: PickableColumn[], sortKey?: string | null): ColumnPicker {
  const [shown, setShown] = useState<string[]>(() => read(id, columns));
  const toggle = (key: string) =>
    setShown((cols) => {
      const next = cols.includes(key) ? cols.filter((k) => k !== key) : [...cols, key];
      try {
        window.localStorage.setItem(storageKey(id), JSON.stringify(next));
      } catch {
        // Not remembered (private browsing): it still toggles
      }
      return next;
    });
  const col = (key: string) => {
    const column = columns.find((c) => c.key === key);
    if (!column) return '';
    return shown.includes(key) || sortKey === key ? 'table-cell' : WIDE_FROM[column.from ?? 'sm'];
  };
  return { columns, isShown: (key) => shown.includes(key), toggle, col };
}
