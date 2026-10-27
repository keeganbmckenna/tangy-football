'use client';

import { useMemo, useState } from 'react';
import LiveTab from '@/components/LiveTab';
import { useMatchupLineups } from '@/components/useMatchupLineups';
import TeamAvatar from '@/components/ui/TeamAvatar';
import { teamAvatarUrl } from '@/lib/analyze/teamIdentity';
import { myWeekMatchupFirst } from '@/lib/analyze/myMatchup';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useSeasonInsights } from '@/hooks/useSeasonInsights';
import { weekAwards } from '@/lib/analyze/awards';
import { LeagueData, WeekMatchup } from '@/lib/types';

interface WeeklyMatchupsProps {
  matchups: Record<number, WeekMatchup[]>;
  lastScoredWeek?: number;
  /** For each matchup's lineups (tap a matchup) */
  leagueData?: LeagueData | null;
  /** The week being played, shown live (the Live tab's matchups and lineups) and picked first */
  live?: { week: number; regularSeasonEnd: number; playoffTeams: number; hasDivisions: boolean } | null;
}

export default function WeeklyMatchups({ matchups, lastScoredWeek, leagueData, live }: WeeklyMatchupsProps) {
  const weeks = Object.keys(matchups)
    .map(Number)
    // Only show completed weeks: the current unscored week's matchups are 0-0 "ties"
    .filter((week) => lastScoredWeek === undefined || week <= lastScoredWeek)
    .sort((a, b) => a - b); // Sort ascending (1, 2, 3, ...)
  // The week being played first, otherwise the most recent completed week
  const [selectedWeek, setSelectedWeek] = useState(live?.week ?? (weeks[weeks.length - 1] || 1));
  const showLive = !!live && selectedWeek === live.week && !!leagueData;

  // My matchup first, with me on the left
  const me = useMyTeam();
  const currentMatchups = myWeekMatchupFirst(matchups[selectedWeek] || [], me.rosterId);

  // The week's awards; the lineup and projection ones once the season's insights load
  const { data: insights } = useSeasonInsights(leagueData?.league.season);
  const awards = useMemo(() => {
    const teamWeeks = insights
      ? new Map(Object.entries(insights.teams).flatMap(([rid, list]) => list.filter((w) => w.week === selectedWeek).map((w) => [Number(rid), w] as const)))
      : undefined;
    return weekAwards(matchups[selectedWeek] ?? [], teamWeeks);
  }, [matchups, selectedWeek, insights]);

  // Tap a matchup for both lineups
  const lineups = useMatchupLineups(leagueData);
  const game = (m: WeekMatchup) => ({
    week: m.week,
    a: { rosterId: m.team1.rosterId, name: m.team1.name, points: m.team1.points },
    b: { rosterId: m.team2.rosterId, name: m.team2.name, points: m.team2.points },
  });

  return (
    <div className="section-card bg-[var(--surface-elevated)] rounded-lg shadow-lg overflow-hidden border border-[var(--border)]">
      <div className="section-header bg-gradient-to-r from-green-600 to-green-800 px-4 py-3 sm:px-6 sm:py-4" data-tone="green">
        <h2 className="text-xl font-bold text-white mb-3 sm:text-2xl">Weekly Matchups</h2>
        <div className="flex gap-1 flex-wrap">
          {weeks.map((week) => (
            <button
              key={week}
              onClick={() => setSelectedWeek(week)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                selectedWeek === week
                  ? 'bg-[var(--surface-elevated)] text-[var(--foreground)]'
                  : 'bg-white/15 text-white hover:bg-white/25'
              }`}
            >
              W{week}
            </button>
          ))}
          {live && (
            <button
              onClick={() => setSelectedWeek(live.week)}
              aria-label={`Week ${live.week}, live`}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                selectedWeek === live.week
                  ? 'bg-[var(--surface-elevated)] text-[var(--foreground)]'
                  : 'bg-white/15 text-white hover:bg-white/25'
              }`}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red-500" />
              W{live.week}
            </button>
          )}
        </div>
      </div>
      {showLive && leagueData && live && (
        <LiveTab compact leagueData={leagueData} regularSeasonEnd={live.regularSeasonEnd} playoffTeams={live.playoffTeams} hasDivisions={live.hasDivisions} />
      )}
      {!showLive && awards.length > 0 && (
        <div className="border-b border-[var(--border)] py-3">
          {/* One row that scrolls sideways on phones, wrapping on wider screens */}
          <ul className="flex gap-2 overflow-x-auto px-4 sm:flex-wrap sm:px-6" aria-label={`Week ${selectedWeek} awards`}>
            {awards.map((a) => (
              <li
                key={a.id}
                className={`w-44 shrink-0 rounded-lg border px-3 py-2 sm:w-auto sm:max-w-[16rem] ${a.rosterId === me.rosterId ? 'border-[var(--accent)]' : 'border-[var(--border)]'} bg-[var(--surface)]`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{a.label}</div>
                <div className="truncate text-sm font-medium text-[var(--foreground)]" title={a.who}>{a.who}</div>
                <div className="text-xs tabular-nums text-[var(--muted)]">{a.detail}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!showLive && <div className="grid gap-3 p-4 sm:gap-4 sm:p-6 md:grid-cols-2">
        {currentMatchups.length === 0 ? (
          <p className="col-span-full text-center text-[var(--muted)] py-8">
            No matchups available for this week
          </p>
        ) : (
          currentMatchups.map((matchup) => (
            <button
              type="button"
              key={matchup.matchupId}
              onClick={() => lineups.openLineups(game(matchup))}
              disabled={!leagueData}
              aria-label={`${matchup.team1.name} vs ${matchup.team2.name}: see lineups`}
              className={`block w-full rounded-lg border p-4 text-left transition-colors hover:bg-[var(--hover)] disabled:hover:bg-transparent ${matchup.team1.rosterId === me.rosterId ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
            >
              <div className="flex items-center justify-between">
                {/* Team 1 */}
                <div
                  className={`min-w-0 flex-1 ${
                    matchup.winner === 'team1'
                      ? 'font-bold text-[var(--success-text)]'
                      : 'text-[var(--foreground)]'
                  }`}
                >
                  <div className="flex items-center gap-2 text-base lg:text-lg">
                    <TeamAvatar url={teamAvatarUrl(leagueData, matchup.team1.rosterId)} name={matchup.team1.name} />
                    <span className="min-w-0 truncate">{matchup.team1.name}</span>
                  </div>
                  <div className="truncate text-sm text-[var(--muted)]">
                    @{matchup.team1.username}
                  </div>

                  <div className="mt-2 text-xl font-bold tabular-nums lg:text-2xl">
                    {matchup.team1.points.toFixed(2)}
                  </div>
                </div>

                {/* VS */}
                {/* Only where there's room: half-width cards need it for the names */}
                <div className="hidden px-6 text-[var(--muted)] font-semibold lg:block">VS</div>
                <div className="w-3 shrink-0 lg:hidden" />

                {/* Team 2 */}
                <div
                  className={`min-w-0 flex-1 text-right ${
                    matchup.winner === 'team2'
                      ? 'font-bold text-[var(--success-text)]'
                      : 'text-[var(--foreground)]'
                  }`}
                >
                  <div className="flex flex-row-reverse items-center gap-2 text-base lg:text-lg">
                    <TeamAvatar url={teamAvatarUrl(leagueData, matchup.team2.rosterId)} name={matchup.team2.name} />
                    <span className="min-w-0 truncate">{matchup.team2.name}</span>
                  </div>
                  <div className="truncate text-sm text-[var(--muted)]">
                    @{matchup.team2.username}
                  </div>

                  <div className="mt-2 text-xl font-bold tabular-nums lg:text-2xl">
                    {matchup.team2.points.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Winner indicator */}
              {matchup.winner && matchup.winner !== 'tie' && (
                <div className="mt-3 text-center text-sm text-[var(--success-text)] font-medium">
                  {matchup.winner === 'team1'
                    ? matchup.team1.name
                    : matchup.team2.name}{' '}
                  wins by{' '}
                  {Math.abs(matchup.team1.points - matchup.team2.points).toFixed(
                    2
                  )}{' '}
                  points
                </div>
              )}
              {matchup.winner === 'tie' && (
                <div className="mt-3 text-center text-sm text-[var(--warning-text)] font-medium">
                  Tie
                </div>
              )}
              {leagueData && (
                <div className="mt-1.5 text-center text-[11px] text-[var(--muted)]">
                  {lineups.isLoading(game(matchup)) ? 'Loading lineups…' : 'Tap for lineups'}
                </div>
              )}
            </button>
          ))
        )}
      </div>}
      {lineups.dialog}
    </div>
  );
}
