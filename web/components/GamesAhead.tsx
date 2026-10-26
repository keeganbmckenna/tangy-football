'use client';

import { useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import { useMyTeam } from '@/hooks/useMyTeam';
import { getHeatmapColorByRatio, RESULT_DOT_COLORS } from '@/lib/constants';
import { formatRecord } from '@/lib/analyze/playEveryone';
import { formatOdds, type PlayoffOddsResponse } from '@/lib/analyze/playoffOdds';
import type { TeamStats } from '@/lib/types';

interface GamesAheadProps {
  gameOdds: NonNullable<PlayoffOddsResponse['gameOdds']>;
  teams: PlayoffOddsResponse['teams'];
  teamStats: TeamStats[];
}

/** Win chance as a heatmap color: 20% or less at the dark end, 80% or more at the bright end */
const cellColor = (p: number) => getHeatmapColorByRatio((p - 0.2) / 0.6);

/**
 * One team's chance of winning each of its remaining regular-season games, from the
 * single-game model (the trade tools' weekly odds), with its expected wins (defaults to your
 * team); or every team's at once as a grid, easiest remaining schedule first.
 */
export default function GamesAhead({ gameOdds, teams, teamStats }: GamesAheadProps) {
  const me = useMyTeam();
  const [picked, setPicked] = useState<number | null>(null);
  const [view, setView] = useState<'team' | 'all'>('team');
  const stats = new Map(teamStats.map((t) => [t.rosterId, t]));
  const name = (id: number) => stats.get(id)?.teamName ?? `Team ${id}`;
  const records = new Map(teams.map((t) => [t.rosterId, formatRecord(t.wins, t.losses, t.ties)]));
  const options = [...teams].sort((a, b) => name(a.rosterId).localeCompare(name(b.rosterId)));
  const rosterId = picked ?? (me.rosterId !== null && records.has(me.rosterId) ? me.rosterId : options[0]?.rosterId);
  if (rosterId === undefined) return null;

  const gamesFor = (id: number) =>
    gameOdds
      .filter((g) => g.a === id || g.b === id)
      .sort((x, y) => x.week - y.week)
      .map((g) => ({ week: g.week, opponent: g.a === id ? g.b : g.a, win: g.a === id ? g.aWins : 1 - g.aWins }));
  const games = gamesFor(rosterId);
  const expected = games.reduce((s, g) => s + g.win, 0);
  const weeks = [...new Set(gameOdds.map((g) => g.week))].sort((a, b) => a - b);
  const grid = teams
    .map((t) => {
      const list = gamesFor(t.rosterId);
      return { rosterId: t.rosterId, byWeek: new Map(list.map((g) => [g.week, g])), expected: list.reduce((s, g) => s + g.win, 0), count: list.length };
    })
    .sort((a, b) => b.expected / (b.count || 1) - a.expected / (a.count || 1));

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex shrink-0 gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1" role="group" aria-label="Show">
            {[
              { id: 'team' as const, label: 'One team' },
              { id: 'all' as const, label: 'All teams' },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setView(o.id)}
                aria-pressed={view === o.id}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  view === o.id ? 'bg-[var(--info-bg)] text-[var(--info-text)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {view === 'team' && (
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
          )}
        </div>
        {view === 'all' ? (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full border-separate border-spacing-0.5 text-center text-xs tabular-nums">
              <thead>
                <tr className="text-[var(--muted)]">
                  <th className="sticky left-0 z-[1] bg-[var(--surface-elevated)] pr-2 text-left font-medium">Team</th>
                  {weeks.map((w) => (
                    <th key={w} className="min-w-[2.25rem] font-medium">W{w}</th>
                  ))}
                  <th className="min-w-[2.75rem] pl-1 font-medium" title="Expected wins over the remaining games">Exp. W</th>
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => (
                  <tr
                    key={row.rosterId}
                    className="cursor-pointer"
                    onClick={() => {
                      setPicked(row.rosterId);
                      setView('team');
                    }}
                    title={`${name(row.rosterId)}: see its games`}
                  >
                    <td
                      className={`sticky left-0 z-[1] max-w-[7rem] truncate bg-[var(--surface-elevated)] py-1 pr-2 text-left text-xs sm:max-w-[11rem] ${
                        row.rosterId === me.rosterId ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--foreground)]'
                      }`}
                    >
                      {name(row.rosterId)}
                    </td>
                    {weeks.map((w) => {
                      const g = row.byWeek.get(w);
                      if (!g) return <td key={w} className="text-[var(--muted)]">–</td>;
                      const { backgroundColor, textColor } = cellColor(g.win);
                      return (
                        <td key={w} className="rounded py-1.5 font-semibold" style={{ backgroundColor, color: textColor }} title={`Week ${w} vs ${name(g.opponent)}: ${formatOdds(g.win)}`}>
                          {Math.round(g.win * 100)}
                        </td>
                      );
                    })}
                    <td className="pl-1 font-semibold text-[var(--foreground)]">{row.expected.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-[var(--muted)]">Win chance (%) in each game, easiest remaining schedule first. Tap a team for its games.</p>
          </div>
        ) : games.length ? (
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
