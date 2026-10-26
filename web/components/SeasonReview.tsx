'use client';

import { useMemo, useState, type ReactNode } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useOddsHistory } from '@/hooks/useOddsData';
import { useSeasonInsights } from '@/hooks/useSeasonInsights';
import { fetchFirst, useSharedFetch } from '@/hooks/useSharedFetch';
import { bracketResults } from '@/lib/analyze/history';
import { luckBreakdown } from '@/lib/analyze/luck';
import { formatRecord } from '@/lib/analyze/playEveryone';
import { lineupEfficiency, playerLeaders, teamMvps } from '@/lib/analyze/rosters';
import type { TradeHistoryResponse } from '@/lib/analyze/trade';
import type { LeagueData, PlayEveryoneStats, TeamStats, WeekMatchup } from '@/lib/types';

interface SeasonReviewProps {
  season: string;
  leagueData: LeagueData;
  teamStats: TeamStats[];
  playEveryone: PlayEveryoneStats[];
  matchups: Record<number, WeekMatchup[]>;
  regularSeasonEnd: number;
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10] ?? 'th'}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

function Tile({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="truncate text-base font-semibold text-[var(--foreground)] sm:text-lg">{children}</div>
      {sub && <div className="truncate text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

/**
 * A finished season, one manager at a time: where they finished, their best and worst weeks,
 * MVP, best pickup and trade, lineup decisions, luck, and how their playoff odds moved
 */
export default function SeasonReview({ season, leagueData, teamStats, playEveryone, matchups, regularSeasonEnd }: SeasonReviewProps) {
  const me = useMyTeam();
  const [picked, setPicked] = useState<number | null>(null);
  const { data: insights } = useSeasonInsights(season);
  const { data: history } = useOddsHistory(season, true);
  const { data: trades } = useSharedFetch<TradeHistoryResponse>(`trades:${season}`, () =>
    fetchFirst([`/data/trades/${season}.json`, `/api/trades/${season}`], `${season} trades`)
  );
  const results = useMemo(() => bracketResults(leagueData.winnersBracket ?? null, leagueData.losersBracket ?? null), [leagueData]);
  const luck = useMemo(() => luckBreakdown(teamStats, playEveryone, matchups, regularSeasonEnd), [teamStats, playEveryone, matchups, regularSeasonEnd]);
  const lineups = useMemo(() => (insights ? lineupEfficiency(insights, leagueData.league.roster_positions ?? []) : null), [insights, leagueData]);
  const mvps = useMemo(() => (insights ? teamMvps(playerLeaders(insights).seasons) : null), [insights]);

  const options = [...teamStats].sort((a, b) => a.teamName.localeCompare(b.teamName));
  const rosterId = picked ?? (me.rosterId !== null && teamStats.some((t) => t.rosterId === me.rosterId) ? me.rosterId : options[0]?.rosterId);
  const team = teamStats.find((t) => t.rosterId === rosterId);
  if (!team) return null;

  const name = (id: number) => teamStats.find((t) => t.rosterId === id)?.teamName ?? `Team ${id}`;
  const player = (id: string) => insights?.players[id]?.name ?? trades?.players[id]?.name ?? id;
  const scores = team.weeklyScores.slice(0, regularSeasonEnd);
  const bestWeek = scores.indexOf(Math.max(...scores));
  const worstWeek = scores.indexOf(Math.min(...scores));
  const pointsRank = [...teamStats].sort((a, b) => b.totalPoints - a.totalPoints).findIndex((t) => t.rosterId === rosterId) + 1;
  const place = results.placements[rosterId];
  const finish =
    results.champion === rosterId ? '🏆 Champion'
      : place ? `${ordinal(place)} place`
      : results.toiletLoser === rosterId ? '🚽 Lost the toilet bowl'
      : results.playoffTeams.includes(rosterId) ? 'Made the playoffs'
      : 'Missed the playoffs';
  const myLuck = luck.find((l) => l.rosterId === rosterId);
  const myLineups = lineups?.find((l) => l.rosterId === rosterId);
  const efficiencyRank = lineups ? [...lineups].sort((a, b) => b.efficiency - a.efficiency).findIndex((l) => l.rosterId === rosterId) + 1 : null;
  const mvp = mvps?.get(rosterId);
  const pickup = insights?.waivers.filter((m) => m.rosterId === rosterId).sort((a, b) => b.startedPoints - a.startedPoints)[0];
  // Best trade by net points: what it got (in its lineup) minus what the other side got (in theirs)
  const trade = trades?.trades
    .flatMap((t) =>
      t.sides
        .filter((s) => s.rosterId === rosterId)
        .map((s) => ({ t, s, net: s.hindsight.points - t.sides.filter((o) => o.rosterId !== rosterId).reduce((sum, o) => sum + o.hindsight.points, 0) }))
    )
    .sort((a, b) => b.net - a.net)[0];
  const odds = (history?.checkpoints ?? []).map((c) => ({ week: c.week, p: c.odds[rosterId]?.playoffs ?? 0 }));
  const low = odds.length ? odds.reduce((m, o) => (o.p < m.p ? o : m)) : null;
  const high = odds.length ? odds.reduce((m, o) => (o.p > m.p ? o : m)) : null;
  const weekLabel = (w: number) => (w === 0 ? 'the draft' : `week ${w}`);

  return (
    <SectionCard title={`${season} in Review`} subtitle="Each manager's season in a page" gradientType="primary">
      <div className="space-y-4 p-4 sm:p-6">
        <label className="flex flex-wrap items-center gap-2 text-sm text-[var(--foreground)]">
          Team
          <select
            value={rosterId}
            onChange={(e) => setPicked(Number(e.target.value))}
            className="max-w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            {options.map((t) => (
              <option key={t.rosterId} value={t.rosterId}>
                {t.teamName}
                {t.rosterId === me.rosterId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <Tile label="Finish" sub={`${ordinal(team.standing)} in the regular season`}>{finish}</Tile>
          <Tile label="Record" sub={`${team.totalPoints.toFixed(0)} pts, ${ordinal(pointsRank)} most`}>{formatRecord(team.wins, team.losses, team.ties)}</Tile>
          <Tile label="Best week" sub={`Week ${bestWeek + 1}`}>{scores[bestWeek]?.toFixed(2)}</Tile>
          <Tile label="Worst week" sub={`Week ${worstWeek + 1}`}>{scores[worstWeek]?.toFixed(2)}</Tile>
          {mvp && (
            <Tile label="MVP" sub={`${mvp.points.toFixed(1)} pts in the lineup`}>
              {player(mvp.playerId)}
            </Tile>
          )}
          {pickup && pickup.startedPoints > 0 && (
            <Tile label="Best pickup" sub={`Week ${pickup.week}${pickup.bid ? `, $${pickup.bid}` : ''} · ${pickup.startedPoints.toFixed(1)} pts`}>
              {player(pickup.playerId)}
            </Tile>
          )}
          {trade && (
            <Tile
              label="Best trade"
              sub={`Week ${trade.t.week} with ${trade.t.sides.filter((s) => s.rosterId !== rosterId).map((s) => name(s.rosterId)).join(', ')} · ${trade.net >= 0 ? '+' : '−'}${Math.abs(trade.net).toFixed(1)} net pts`}
            >
              {trade.s.receives.map(player).join(', ') || trade.s.picks.join(', ') || 'Picks and FAAB'}
            </Tile>
          )}
          {myLineups && (
            <Tile label="Lineups" sub={`${myLineups.leftOnBench.toFixed(0)} left on bench${myLineups.flippedLosses ? ` · ${myLineups.flippedLosses} loss${myLineups.flippedLosses === 1 ? '' : 'es'} it cost` : ''}`}>
              {(myLineups.efficiency * 100).toFixed(1)}%{efficiencyRank && <span className="text-sm font-normal text-[var(--muted)]"> · {ordinal(efficiencyRank)}</span>}
            </Tile>
          )}
          {myLuck && (
            <Tile label="Luck" sub={`Close games ${formatRecord(myLuck.close.wins, myLuck.close.losses, myLuck.close.ties)}`}>
              {myLuck.total > 0 ? '+' : myLuck.total < 0 ? '−' : ''}
              {Math.abs(myLuck.total).toFixed(1)} wins
            </Tile>
          )}
          {low && high && (
            <Tile label="Playoff odds" sub={`Low ${pct(low.p)} after ${weekLabel(low.week)}, high ${pct(high.p)} after ${weekLabel(high.week)}`}>
              <svg viewBox={`0 0 ${Math.max(odds.length - 1, 1)} 1`} preserveAspectRatio="none" className="mt-1 h-7 w-full" aria-hidden>
                <polyline
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  points={odds.map((o, i) => `${i},${1 - o.p}`).join(' ')}
                />
              </svg>
            </Tile>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
