'use client';

import SectionCard from '@/components/ui/SectionCard';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { useOddsHistory, usePlayoffOdds } from '@/hooks/useOddsData';
import { formatRecord } from '@/lib/analyze/playEveryone';
import type { TeamStats } from '@/lib/types';

interface PowerRankingsProps {
  season: string;
  teamStats: TeamStats[];
}

/** Ranks from expected weekly scores (1 = highest) */
const ranksOf = (strength: Record<number, number>) =>
  new Map(
    Object.entries(strength)
      .sort(([, a], [, b]) => b - a)
      .map(([id], i) => [Number(id), i + 1])
  );

/**
 * Power rankings from the playoff-odds model: teams ranked by expected weekly score, with how
 * sure each rank is (an 80% range from the model's uncertainty in true strength) and the move
 * since last week (from the odds history)
 */
export default function PowerRankings({ season, teamStats }: PowerRankingsProps) {
  const me = useMyTeam();
  const { data } = usePlayoffOdds();
  const { data: history } = useOddsHistory(season);
  if (!data?.strength || data.status !== 'in_progress') return null;

  const strength = data.strength;
  const n = Object.keys(strength).length;
  const stats = new Map(teamStats.map((t) => [t.rosterId, t]));
  const records = new Map(data.teams.map((t) => [t.rosterId, formatRecord(t.wins, t.losses, t.ties)]));
  const previous = history?.checkpoints.find((c) => c.week === data.lastScoredWeek - 1)?.strength;
  const lastRanks = previous ? ranksOf(previous) : null;
  const rows = Object.entries(strength)
    .map(([id, s]) => ({ rosterId: Number(id), ...s }))
    .sort((a, b) => a.rank - b.rank);
  const pos = (rank: number) => `${((rank - 1) / Math.max(n - 1, 1)) * 100}%`;

  return (
    <SectionCard
      title="Power Rankings"
      subtitle={`Who's actually best after week ${data.lastScoredWeek}, by the playoff-odds model`}
      gradientType="accent"
      footer={
        <span>
          Ranked by each team&apos;s expected weekly score from the playoff-odds model: its projected lineup for the rest of the
          season and its points per game so far, weighted as fitted on thousands of other leagues. The range is where its rank
          lands 80% of the time given how unsure the model still is about true strength, so overlapping ranges are close to a
          toss-up. The arrow is the move since last week.
        </span>
      }
    >
      <ul className="divide-y divide-[var(--border)]">
        {rows.map((r) => {
          const move = lastRanks?.get(r.rosterId) !== undefined ? lastRanks.get(r.rosterId)! - r.rank : null;
          const name = stats.get(r.rosterId)?.teamName ?? `Team ${r.rosterId}`;
          return (
            <li key={r.rosterId} className={`flex items-center gap-3 px-4 py-2.5 sm:px-6 ${mineRow(r.rosterId === me.rosterId)}`}>
              <span className="w-5 shrink-0 text-right text-sm font-bold tabular-nums text-[var(--foreground)]">{r.rank}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--foreground)]" title={name}>{name}</div>
                <div className="text-xs text-[var(--muted)]">
                  {records.get(r.rosterId)} · {r.mean.toFixed(1)} pts/wk
                </div>
              </div>
              {/* Rank range: 1 at the left, last at the right */}
              <div
                className="relative h-4 w-20 shrink-0 sm:w-40"
                title={r.rankLow === r.rankHigh ? `Rank ${r.rank}` : `Likely rank ${r.rankLow}–${r.rankHigh}`}
              >
                <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
                <div
                  className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-40"
                  style={{ left: pos(r.rankLow), width: `calc(${pos(r.rankHigh)} - ${pos(r.rankLow)})` }}
                />
                <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)]" style={{ left: pos(r.rank) }} />
              </div>
              <span
                className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums"
                style={{ color: !move ? 'var(--muted)' : move > 0 ? 'var(--success-text)' : 'var(--danger-text)' }}
              >
                {move === null ? '' : move === 0 ? '–' : `${move > 0 ? '▲' : '▼'}${Math.abs(move)}`}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-3 px-4 pb-3 text-[10px] text-[var(--muted)] sm:px-6">
        <span>Range: 1st ← → {n}th</span>
      </div>
    </SectionCard>
  );
}
