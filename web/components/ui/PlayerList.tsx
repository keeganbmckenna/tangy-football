'use client';

import type { ReactNode } from 'react';
import type { TradePlayerInfo } from '@/lib/analyze/trade';

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
export const positionRank = (p: string) => {
  const i = POSITION_ORDER.indexOf(p);
  return i === -1 ? POSITION_ORDER.length : i;
};

/**
 * A list of players to tap on and off (the players a manager sends, the free agents to add, the
 * players to drop), with each one's scoring, expected points and market value.
 */
export default function PlayerList({
  header,
  players,
  selected,
  onToggle,
  color,
  marketValues,
  empty,
  footer,
  byPosition = true,
}: {
  header: ReactNode;
  players: TradePlayerInfo[];
  selected: string[];
  onToggle: (id: string) => void;
  color: string;
  marketValues: boolean;
  /** Shown instead of the list (e.g. before a team is picked) */
  empty?: string | null;
  footer?: ReactNode;
  /** In lineup order (rosters), or as given (free agents, best first) */
  byPosition?: boolean;
}) {
  const sorted = byPosition
    ? [...players].sort((x, y) => positionRank(x.position) - positionRank(y.position) || y.expectedPerWeek - x.expectedPerWeek)
    : players;
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] p-3">{header}</div>
      {empty ? (
        <p className="p-4 text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {sorted.map((p) => {
            const on = selected.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onToggle(p.id)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--neutral-bg)]"
                  style={on ? { boxShadow: `inset 4px 0 0 ${color}`, backgroundColor: 'var(--neutral-bg)' } : undefined}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold text-white"
                    style={{ borderColor: on ? color : 'var(--chart-axis)', backgroundColor: on ? color : 'transparent' }}
                    aria-hidden
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[var(--foreground)]">{p.name}</span>
                    <span className="block text-xs text-[var(--muted)]">
                      {p.position}
                      {p.team ? ` · ${p.team}` : ''}
                      {p.seasonPerGame !== null ? ` · ${p.seasonPerGame.toFixed(1)} ppg` : ''}
                      {p.byeWeek ? ` · bye ${p.byeWeek}` : ''}
                      {p.injury ? <span className="ml-1 font-semibold text-[var(--danger-text)]">{p.injury}</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm text-[var(--foreground)]">{p.expectedPerWeek.toFixed(1)}/wk</span>
                    {marketValues && <span className="block text-xs text-[var(--muted)]">{p.value !== null ? p.value.toLocaleString() : '—'}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {footer}
    </div>
  );
}
