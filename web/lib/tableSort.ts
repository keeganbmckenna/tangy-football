/**
 * Sorting for data tables: a header click sorts best-first, a second click
 * reverses it, and a third drops it, back to the sort before (or the table's
 * own order, which is always kept: see components/ui/SortableTh.tsx). Earlier
 * sorts break the ties of the latest.
 */

export type SortDir = 'asc' | 'desc';

export interface SortKey {
  key: string;
  dir: SortDir;
  /** Column name, for "Sorted by ..." */
  label: string;
}

export interface SortState extends SortKey {
  /** Earlier sorts, most recent first: they order the rows the latest one ties */
  then?: SortKey[];
}

/** How many earlier sorts break ties */
export const MAX_TIEBREAKS = 2;

/** A sortable value: null or undefined (shown as "—") always sorts last */
export type SortValue = number | string | null | undefined;

/** Next state after clicking a column whose best-first direction is `best` */
export function nextSort(state: SortState | null, key: string, best: SortDir, label: string): SortState | null {
  if (!state) return { key, dir: best, label };
  const then = state.then ?? [];
  if (state.key !== key) {
    // The current sort (and those before it) now break this one's ties
    const earlier = [{ key: state.key, dir: state.dir, label: state.label }, ...then].filter((k) => k.key !== key).slice(0, MAX_TIEBREAKS);
    return { key, dir: best, label, then: earlier };
  }
  if (state.dir === best) return { key, dir: best === 'desc' ? 'asc' : 'desc', label, ...(then.length ? { then } : {}) };
  // Dropped: back to the sort before it
  if (!then.length) return null;
  const [previous, ...rest] = then;
  return { ...previous, ...(rest.length ? { then: rest } : {}) };
}

/** Every column the rows are sorted by, the latest first */
export function sortKeys(state: SortState | null): string[] {
  return state ? [state.key, ...(state.then ?? []).map((k) => k.key)] : [];
}

/**
 * Rows in sorted order, by the latest sort and then the earlier ones (a stable sort, so
 * remaining ties keep the table's own order); the input isn't changed
 */
export function sortRows<T>(rows: T[], state: SortState | null, value: (row: T, key: string) => SortValue): T[] {
  if (!state) return rows;
  const keys = [state, ...(state.then ?? [])];
  const blank = (v: SortValue) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
  return rows
    .map((row, i) => ({ row, i, v: keys.map((k) => value(row, k.key)) }))
    .sort((a, b) => {
      for (let j = 0; j < keys.length; j++) {
        const av = a.v[j];
        const bv = b.v[j];
        const an = blank(av);
        const bn = blank(bv);
        // Blanks last, whichever way
        if (an || bn) {
          if (an === bn) continue;
          return an ? 1 : -1;
        }
        const c = typeof av === 'string' || typeof bv === 'string' ? String(av).localeCompare(String(bv)) : (av as number) - (bv as number);
        if (c !== 0) return (keys[j].dir === 'asc' ? 1 : -1) * c;
      }
      return a.i - b.i;
    })
    .map((x) => x.row);
}

/** A W-L-T record as one number: win % (ties count half), then more wins */
export function recordValue(wins: number, losses: number, ties = 0): number | null {
  const games = wins + losses + ties;
  if (games === 0) return null;
  return (wins + ties / 2) / games + wins * 1e-6;
}
