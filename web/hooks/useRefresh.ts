'use client';

import { useEffect, useRef } from 'react';

/**
 * The header's refresh button (components/ui/RefreshButton.tsx), told to the parts of the page
 * that load their own data (the Live tab, the trade and waiver tools, the playoff odds), so each
 * reloads in place, keeping what's shown until the new data arrives.
 */
type Listener = () => Promise<unknown> | void;
const listeners = new Set<Listener>();

/** Tell every listener to reload; resolves once the reloads that report back have finished */
export async function broadcastRefresh(): Promise<void> {
  await Promise.allSettled([...listeners].map((l) => l()));
}

/** Subscribe outside React (module-level loaders); returns the unsubscribe */
export function onRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Run reload when the refresh button is pressed (the latest reload, without resubscribing) */
export function useOnRefresh(reload: Listener) {
  const ref = useRef(reload);
  useEffect(() => {
    ref.current = reload;
  });
  useEffect(() => onRefresh(() => ref.current()), []);
}
