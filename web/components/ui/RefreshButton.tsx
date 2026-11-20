'use client';

import { useEffect, useRef, useState } from 'react';

const RefreshIcon = ({ spinning }: { spinning: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className={`h-5 w-5 ${spinning ? 'motion-safe:animate-spin' : ''}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v5h-5" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * Get the latest from Sleeper without reloading the page: the tab, scroll position and open
 * cards stay. Mostly for the home-screen web app on phones, which has no reload button.
 * Spins while loading, shows a check when done, and says so in a toast if it failed.
 */
export default function RefreshButton({ onRefresh }: { onRefresh: () => Promise<boolean> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const run = async () => {
    if (state === 'busy') return;
    window.clearTimeout(timer.current);
    setState('busy');
    const ok = await onRefresh().catch(() => false);
    if (ok) setUpdatedAt(Date.now());
    setState(ok ? 'done' : 'failed');
    timer.current = window.setTimeout(() => setState('idle'), ok ? 2000 : 4000);
  };

  const label = state === 'busy' ? 'Getting the latest from Sleeper' : 'Get the latest from Sleeper';
  return (
    <>
      <button
        type="button"
        onClick={run}
        aria-label={label}
        aria-busy={state === 'busy'}
        title={updatedAt ? `${label} (last updated ${time(updatedAt)})` : label}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] shadow-sm transition hover:bg-[var(--hover)] ${
          state === 'done' ? 'text-[var(--success-text)]' : 'text-[var(--foreground)]'
        }`}
      >
        {state === 'done' ? <CheckIcon /> : <RefreshIcon spinning={state === 'busy'} />}
      </button>
      <p className="sr-only" role="status" aria-live="polite">
        {state === 'done' && updatedAt ? `Updated from Sleeper at ${time(updatedAt)}` : ''}
      </p>
      {state === 'failed' && (
        <p
          role="alert"
          className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-center text-sm text-[var(--foreground)] shadow-lg"
        >
          Couldn&apos;t reach Sleeper. Still showing what was loaded before.
        </p>
      )}
    </>
  );
}
