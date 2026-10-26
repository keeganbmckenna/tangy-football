'use client';

import type { SeasonInsights } from '@/lib/analyze/insights';
import type { TeamStats } from '@/lib/types';

/** What every Rosters card gets */
export interface RostersCardProps {
  insights: SeasonInsights;
  teamStats: TeamStats[];
}

/** Position colors for the Rosters charts */
export const POSITION_COLORS: Record<string, string> = {
  QB: '#ef4444',
  RB: '#22c55e',
  WR: '#3b82f6',
  TE: '#f59e0b',
  K: '#a855f7',
  DEF: '#64748b',
  Other: '#94a3b8',
};

export const teamNames = (teamStats: TeamStats[]) => {
  const names = new Map(teamStats.map((t) => [t.rosterId, t.teamName]));
  return (id: number) => names.get(id) ?? `Team ${id}`;
};

export const playerName = (insights: SeasonInsights, id: string) => insights.players[id]?.name ?? id;

/** "J. Jefferson" on phones, the full name on wider screens */
export function PlayerLabel({ insights, id }: { insights: SeasonInsights; id: string }) {
  const p = insights.players[id];
  const full = p?.name ?? id;
  const short = p?.position === 'DEF' ? full : full.replace(/^(\S)\S*\s+(?=\S)/, '$1. ');
  return (
    <span title={full}>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </span>
  );
}

export const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

export const TH = 'px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--muted)] sm:px-4';
export const TD = 'px-3 py-3 whitespace-nowrap text-center text-sm tabular-nums text-[var(--foreground)] sm:px-4';
