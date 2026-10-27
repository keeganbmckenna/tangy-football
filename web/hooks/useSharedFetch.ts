'use client';

import { useEffect, useState } from 'react';

// One request per key per visit, shared by every component that asks for it
const requests = new Map<string, Promise<unknown>>();

/**
 * Fetch once per visit and share the result: the first caller's loader runs, later callers
 * (other cards, other tabs) get the same promise. A failed load is forgotten so retry works.
 * keepWhile: while a new key loads, keep showing the last data if its key starts with this
 * (a refresh of the same thing), instead of nothing, so what's on screen doesn't blink.
 */
export function useSharedFetch<T>(
  key: string | null,
  loader: () => Promise<T>,
  keepWhile?: string
): { data: T | null; error: string | null; retry: () => void } {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let request = requests.get(key) as Promise<T> | undefined;
    if (!request) {
      request = loader();
      request.catch(() => requests.delete(key));
      requests.set(key, request);
    }
    request
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((err) => !cancelled && setState({ key, data: null, error: err instanceof Error ? err.message : 'Failed to load' }));
    return () => {
      cancelled = true;
    };
    // The loader is tied to the key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const current = state?.key === key ? state : keepWhile && state?.data && state.key.startsWith(keepWhile) ? { ...state, error: null } : null;
  return { data: current?.data ?? null, error: current?.error ?? null, retry: () => setAttempt((a) => a + 1) };
}

/** JSON from the first URL that answers (a pre-built file, then the API) */
export async function fetchFirst<T>(urls: string[], what: string): Promise<T> {
  for (const url of urls) {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) return (await res.json()) as T;
  }
  throw new Error(`Failed to load ${what}`);
}
