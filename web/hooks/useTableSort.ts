import { useCallback, useState } from 'react';
import { nextSort, type SortDir, type SortState } from '@/lib/tableSort';

export interface TableSort {
  state: SortState | null;
  toggle: (key: string, best: SortDir, label: string) => void;
  reset: () => void;
}

// Each table's sort for this visit, so leaving a tab and coming back keeps it
// (cleared on a season change and on reload)
const remembered = new Map<string, SortState | null>();

export function resetTableSorts() {
  remembered.clear();
}

/** Sort state for one table (`id` names it for this visit); starts in the table's own order */
export function useTableSort(id: string): TableSort {
  const [state, setState] = useState<SortState | null>(() => remembered.get(id) ?? null);
  const update = useCallback(
    (next: (s: SortState | null) => SortState | null) =>
      setState((s) => {
        const n = next(s);
        remembered.set(id, n);
        return n;
      }),
    [id]
  );
  const toggle = useCallback(
    (key: string, best: SortDir, label: string) => update((s) => nextSort(s, key, best, label)),
    [update]
  );
  const reset = useCallback(() => update(() => null), [update]);
  return { state, toggle, reset };
}
