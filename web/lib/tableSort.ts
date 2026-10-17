/**
 * Sorting for data tables: a header click sorts best-first, a second click
 * reverses it, and a third goes back to the table's own order, which is
 * always kept (see components/ui/SortableTh.tsx).
 */

export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: string;
  dir: SortDir;
  /** Column name, for "Sorted by ..." */
  label: string;
}

/** A sortable value: null or undefined (shown as "—") always sorts last */
export type SortValue = number | string | null | undefined;

/** Next state after clicking a column whose best-first direction is `best` */
export function nextSort(state: SortState | null, key: string, best: SortDir, label: string): SortState | null {
  if (!state || state.key !== key) return { key, dir: best, label };
  if (state.dir === best) return { key, dir: best === 'desc' ? 'asc' : 'desc', label };
  return null;
}

/** Rows in sorted order (a stable sort, so ties keep the table's own order); the input isn't changed */
export function sortRows<T>(rows: T[], state: SortState | null, value: (row: T, key: string) => SortValue): T[] {
  if (!state) return rows;
  const sign = state.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: value(row, state.key) }))
    .sort((a, b) => {
      const an = a.v === null || a.v === undefined || (typeof a.v === 'number' && Number.isNaN(a.v));
      const bn = b.v === null || b.v === undefined || (typeof b.v === 'number' && Number.isNaN(b.v));
      if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
      const c = typeof a.v === 'string' || typeof b.v === 'string'
        ? String(a.v).localeCompare(String(b.v))
        : (a.v as number) - (b.v as number);
      return c !== 0 ? sign * c : a.i - b.i;
    })
    .map((x) => x.row);
}

/** A W-L-T record as one number: win % (ties count half), then more wins */
export function recordValue(wins: number, losses: number, ties = 0): number | null {
  const games = wins + losses + ties;
  if (games === 0) return null;
  return (wins + ties / 2) / games + wins * 1e-6;
}
