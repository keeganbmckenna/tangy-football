'use client';

import { useMemo } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import { useMyTeam } from '@/hooks/useMyTeam';
import { POSITION_ORDER, positionPoints } from '@/lib/analyze/rosters';
import { PlayerLabel, POSITION_COLORS, teamNames, type RostersCardProps } from './shared';

/**
 * Where each team's points come from: its starters' points by position against the league
 * average, and how much it leans on its top scorer
 */
export default function PositionPoints({ insights, teamStats }: RostersCardProps) {
  const me = useMyTeam();
  const data = useMemo(() => positionPoints(insights), [insights]);
  const name = teamNames(teamStats);
  const positions = POSITION_ORDER.filter((p) => data.some((t) => (t.byPosition[p] ?? 0) > 0));
  const league = Object.fromEntries(positions.map((p) => [p, data.reduce((s, t) => s + (t.byPosition[p] ?? 0), 0) / data.length]));
  const leagueTotal = Object.values(league).reduce((s, v) => s + v, 0);
  const rows = [...data].sort((a, b) => b.total - a.total);
  const max = Math.max(...rows.map((t) => t.total), leagueTotal);

  const bar = (byPosition: Record<string, number>, total: number) => (
    <div className="flex h-4 overflow-hidden rounded" style={{ width: `${(total / max) * 100}%` }}>
      {positions.map((p) => {
        const v = byPosition[p] ?? 0;
        return v > 0 ? (
          <div key={p} style={{ width: `${(v / total) * 100}%`, backgroundColor: POSITION_COLORS[p] }} title={`${p}: ${v.toFixed(1)} (${((v / total) * 100).toFixed(0)}%)`} />
        ) : null;
      })}
    </div>
  );

  return (
    <SectionCard
      title="Points by Position"
      subtitle="Where each team's starting-lineup points come from"
      gradientType="success"
      footer={
        <span>
          Bars are season totals of each team&apos;s starters, split by position (hover a segment for its points). The
          share is how much of the team&apos;s points came from its top scorer: high means a lot rides on one player.
        </span>
      }
    >
      <div className="space-y-3 p-4 sm:p-6">
        <div className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
          {positions.map((p) => (
            <span key={p} className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: POSITION_COLORS[p] }} />
              {p}
            </span>
          ))}
        </div>
        {rows.map((t) => (
          <div key={t.rosterId}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs sm:text-sm">
              <span className={`truncate ${t.rosterId === me.rosterId ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--foreground)]'}`}>
                {name(t.rosterId)} <span className="tabular-nums text-[var(--muted)]">{t.total.toFixed(0)}</span>
              </span>
              {t.top && (
                <span className="shrink-0 text-[var(--muted)]">
                  <PlayerLabel insights={insights} id={t.top.playerId} /> {(t.top.share * 100).toFixed(0)}%
                </span>
              )}
            </div>
            {bar(t.byPosition, t.total)}
          </div>
        ))}
        <div className="border-t border-[var(--border)] pt-3">
          <div className="mb-1 text-xs text-[var(--muted)] sm:text-sm">
            League average <span className="tabular-nums">{leagueTotal.toFixed(0)}</span>
          </div>
          {bar(league, leagueTotal)}
        </div>
      </div>
    </SectionCard>
  );
}
