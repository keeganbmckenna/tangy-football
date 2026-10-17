import { useCallback, useState } from 'react';
import { nextSort, type SortDir, type SortState } from '@/lib/tableSort';

export interface TableSort {
  state: SortState | null;
  toggle: (key: string, best: SortDir, label: string) => void;
  reset: () => void;
}

/** Sort state for one table; starts in the table's own order */
export function useTableSort(): TableSort {
  const [state, setState] = useState<SortState | null>(null);
  const toggle = useCallback(
    (key: string, best: SortDir, label: string) => setState((s) => nextSort(s, key, best, label)),
    []
  );
  const reset = useCallback(() => setState(null), []);
  return { state, toggle, reset };
}
