'use client';

import type { ReactNode, RefObject } from 'react';
import { formatOdds } from '@/lib/analyze/playoffOdds';

/**
 * On phones, a bar held at the bottom of the screen while players are picked from long lists:
 * the move, its headline effect, and a jump down to the full results.
 */
export default function StickyResult({
  move,
  before,
  after,
  target,
}: {
  move: ReactNode;
  /** Playoff odds without and with the move (null while simulating) */
  before: number | null | undefined;
  after: number | null | undefined;
  target: RefObject<HTMLElement | null>;
}) {
  const ready = before != null && after != null;
  const d = ready ? (after - before) * 100 : 0;
  const tone = Math.abs(d) < 0.5 ? 'var(--muted)' : d > 0 ? 'var(--success-text)' : 'var(--danger-text)';
  return (
    <div className="sticky bottom-3 z-20 md:hidden">
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 shadow-lg">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-[var(--muted)]">{move}</div>
          <div className="text-sm text-[var(--foreground)]">
            Playoffs{' '}
            {ready ? (
              <>
                {formatOdds(before)} → <strong>{formatOdds(after)}</strong>{' '}
                <span className="text-xs font-semibold" style={{ color: tone }}>
                  {Math.abs(d) < 0.5 ? '~0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)}`}
                </span>
              </>
            ) : (
              <span className="text-xs text-[var(--muted)]">simulating…</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => target.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="shrink-0 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white"
        >
          See results ↓
        </button>
      </div>
    </div>
  );
}
