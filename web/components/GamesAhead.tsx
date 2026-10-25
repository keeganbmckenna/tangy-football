'use client';

import { useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import { useMyTeam } from '@/hooks/useMyTeam';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import { formatRecord } from '@/lib/analyze/playEveryone';
import { formatOdds, type PlayoffOddsResponse } from '@/lib/analyze/playoffOdds';
import type { TeamStats } from '@/lib/types';

interface GamesAheadProps {
  gameOdds: NonNullable<PlayoffOddsResponse['gameOdds']>;
  teams: PlayoffOddsResponse['teams'];
  teamStats: TeamStats[];
}

/**
 * One team's chance of winning each of its remaining regular-season games, from the
 * single-game model (the trade tools' weekly odds), with its expected wins. Defaults to your team.
 */
export default function GamesAhead({ gameOdds, teams, teamStats }: GamesAheadProps) {
  const me = useMyTeam();
  const [picked, setPicked] = useState<number | null>(null);
  const stats = new Map(teamStats.map((t) => [t.rosterId, t]));
  const name = (id: number) => stats.get(id)?.teamName ?? `Team ${id}`;
  const records = new Map(teams.map((t) => [t.rosterId, formatRecord(t.wins, t.losses, t.ties)]));
  const options = [...teams].sort((a, b) => name(a.rosterId).localeCompare(name(b.rosterId)));
  const rosterId = picked ?? (me.rosterId !== null && records.has(me.rosterId) ? me.rosterId : options[0]?.rosterId);
  if (rosterId === undefined) return null;

  const games = gameOdds
    .filter((g) => g.a === rosterId || g.b === rosterId)
    .sort((x, y) => x.week - y.week)
    .map((g) => ({ week: g.week, opponent: g.a === rosterId ? g.b : g.a, win: g.a === rosterId ? g.aWins : 1 - g.aWins }));
  const expected = games.reduce((s, g) => s + g.win, 0);

  return (
    <SectionCard
      title="Games Ahead"
      subtitle="A team's chance of winning each remaining game"
      gradientType="secondary"
      footer={
        <span>
          Each game&apos;s odds come from a model fitted for a single week&apos;s score (the one the trade tools use): next
          week leans on that week&apos;s projected lineups, so byes and injuries count; later weeks lean more on points per
          game. Tested on 1.1 million games in other leagues, it beat the earlier weekly odds out of sample. This
          week&apos;s odds are from before kickoff; the Live tab follows them as the games go.
        </span>
      }
    >
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
                {name(t.rosterId)}
                {t.rosterId === me.rosterId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </label>
        {games.length ? (
          <>
            <ul className="divide-y divide-[var(--border)]">
              {games.map((g) => {
                const color = g.win >= 0.5 ? RESULT_DOT_COLORS.W : RESULT_DOT_COLORS.L;
                return (
                  <li key={g.week} className="flex items-center gap-3 py-2">
                    <span className="w-8 shrink-0 text-xs font-medium text-[var(--muted)]">W{g.week}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-[var(--foreground)]" title={name(g.opponent)}>
                        vs {name(g.opponent)}
                      </div>
                      <div className="text-xs text-[var(--muted)]">{records.get(g.opponent)}</div>
                    </div>
                    <div className="w-20 shrink-0 sm:w-32">
                      <div className="text-right text-sm font-semibold tabular-nums" style={{ color }}>
                        {formatOdds(g.win)}
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-[var(--border)]">
                        <div className="h-full rounded-full" style={{ width: `${g.win * 100}%`, backgroundColor: color }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-sm text-[var(--muted)]">
              Expected wins: <span className="font-semibold text-[var(--foreground)]">{expected.toFixed(1)}</span> of{' '}
              {games.length}, for a final record around{' '}
              <span className="font-semibold text-[var(--foreground)]">
                {(() => {
                  const t = teams.find((x) => x.rosterId === rosterId)!;
                  const wins = Math.round(expected);
                  return formatRecord(t.wins + wins, t.losses + games.length - wins, t.ties);
                })()}
              </span>
              .
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">No regular-season games left.</p>
        )}
      </div>
    </SectionCard>
  );
}
