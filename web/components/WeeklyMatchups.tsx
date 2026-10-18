'use client';

import { useState } from 'react';
import { useMatchupLineups } from '@/components/useMatchupLineups';
import TeamAvatar from '@/components/ui/TeamAvatar';
import { teamAvatarUrl } from '@/lib/analyze/teamIdentity';
import { LeagueData, WeekMatchup } from '@/lib/types';

interface WeeklyMatchupsProps {
  matchups: Record<number, WeekMatchup[]>;
  lastScoredWeek?: number;
  /** For each matchup's lineups (tap a matchup) */
  leagueData?: LeagueData | null;
}

export default function WeeklyMatchups({ matchups, lastScoredWeek, leagueData }: WeeklyMatchupsProps) {
  const weeks = Object.keys(matchups)
    .map(Number)
    // Only show completed weeks: the current unscored week's matchups are 0-0 "ties"
    .filter((week) => lastScoredWeek === undefined || week <= lastScoredWeek)
    .sort((a, b) => a - b); // Sort ascending (1, 2, 3, ...)
  const [selectedWeek, setSelectedWeek] = useState(weeks[weeks.length - 1] || 1); // Default to most recent completed week

  const currentMatchups = matchups[selectedWeek] || [];

  // Tap a matchup for both lineups
  const lineups = useMatchupLineups(leagueData);
  const game = (m: WeekMatchup) => ({
    week: m.week,
    a: { rosterId: m.team1.rosterId, name: m.team1.name, points: m.team1.points },
    b: { rosterId: m.team2.rosterId, name: m.team2.name, points: m.team2.points },
  });

  return (
    <div className="section-card bg-[var(--surface-elevated)] rounded-lg shadow-lg overflow-hidden border border-[var(--border)]">
      <div className="section-header bg-gradient-to-r from-green-600 to-green-800 px-6 py-4" data-tone="green">
        <h2 className="text-2xl font-bold text-white mb-3">Weekly Matchups</h2>
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
        </div>
      </div>
      <div className="grid gap-3 p-4 sm:gap-4 sm:p-6 md:grid-cols-2">
        {currentMatchups.length === 0 ? (
          <p className="col-span-full text-center text-[var(--muted)] py-8">
            No matchups available for this week
          </p>
        ) : (
          currentMatchups.map((matchup, index) => (
            <button
              type="button"
              key={index}
              onClick={() => lineups.openLineups(game(matchup))}
              disabled={!leagueData}
              aria-label={`${matchup.team1.name} vs ${matchup.team2.name}: see lineups`}
              className="block w-full rounded-lg border border-[var(--border)] p-4 text-left transition-colors hover:bg-[var(--hover)] disabled:hover:bg-transparent"
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
      </div>
      {lineups.dialog}
    </div>
  );
}
