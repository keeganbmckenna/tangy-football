'use client';

import { useCallback, useState } from 'react';
import MatchupDetail, { type MatchupPlayer, type MatchupSide } from '@/components/MatchupDetail';
import type { MatchupPlayersData } from '@/app/api/matchup-players/route';
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

  // Lineups: each week's player names and original projections, loaded on the first tap
  const [players, setPlayers] = useState<Record<string, MatchupPlayersData['players']>>({});
  const [open, setOpen] = useState<WeekMatchup | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const season = leagueData?.league.season;
  const openMatchup = async (m: WeekMatchup) => {
    const key = `${season}:${m.week}`;
    if (!players[key]) {
      setLoadingId(`${m.week}:${m.matchupId}`);
      try {
        const res = await fetch(`/api/matchup-players?season=${season}&week=${m.week}`);
        const json = res.ok ? ((await res.json()) as MatchupPlayersData) : { players: {} };
        setPlayers((all) => ({ ...all, [key]: json.players }));
      } catch {
        setPlayers((all) => ({ ...all, [key]: {} }));
      } finally {
        setLoadingId(null);
      }
    }
    setOpen(m);
  };
  const side = (m: WeekMatchup, team: WeekMatchup['team1']): MatchupSide | null => {
    const sm = leagueData?.matchups[m.week]?.find((x) => x.roster_id === team.rosterId);
    if (!sm) return null;
    const info = players[`${season}:${m.week}`] ?? {};
    // Defenses' IDs are their team codes (one on bye has no projection to name it)
    const isDefense = (id: string) => /^[A-Z]{2,3}$/.test(id);
    const player = (id: string): MatchupPlayer => ({
      playerId: id,
      name: info[id]?.name ?? (isDefense(id) ? `${id} Defense` : `Player ${id}`),
      position: info[id]?.position ?? (isDefense(id) ? 'DEF' : ''),
      team: info[id]?.team ?? (isDefense(id) ? id : null),
      points: sm.players_points?.[id] ?? 0,
      projected: info[id] ? info[id].projected : null,
    });
    const starters = sm.starters ?? [];
    const projected = starters.reduce((t, id) => t + (info[id]?.projected ?? 0), 0);
    return {
      name: team.name,
      score: team.points,
      sub: projected > 0 ? `projected ${projected.toFixed(1)}` : undefined,
      starters: starters.map((id) => (!id || id === '0' ? null : player(id))),
      bench: (sm.players ?? []).filter((id) => !starters.includes(id)).map(player).sort((x, y) => y.points - x.points),
    };
  };
  const detail = open && (() => {
    const a = side(open, open.team1);
    const b = side(open, open.team2);
    return a && b ? { a, b } : null;
  })();

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
      <div className="p-6 space-y-4">
        {currentMatchups.length === 0 ? (
          <p className="text-center text-[var(--muted)] py-8">
            No matchups available for this week
          </p>
        ) : (
          currentMatchups.map((matchup, index) => (
            <button
              type="button"
              key={index}
              onClick={() => openMatchup(matchup)}
              disabled={!leagueData}
              aria-label={`${matchup.team1.name} vs ${matchup.team2.name}: see lineups`}
              className="block w-full rounded-lg border border-[var(--border)] p-4 text-left transition-colors hover:bg-[var(--hover)] disabled:hover:bg-transparent"
            >
              <div className="flex items-center justify-between">
                {/* Team 1 */}
                <div
                  className={`flex-1 ${
                    matchup.winner === 'team1'
                      ? 'font-bold text-[var(--success-text)]'
                      : 'text-[var(--foreground)]'
                  }`}
                >
                  <div className="text-lg">{matchup.team1.name}</div>
                  <div className="text-sm text-[var(--muted)]">
                    @{matchup.team1.username}
                  </div>

                  <div className="text-2xl font-bold mt-2">
                    {matchup.team1.points.toFixed(2)}
                  </div>
                </div>

                {/* VS */}
                <div className="px-6 text-[var(--muted)] font-semibold">VS</div>

                {/* Team 2 */}
                <div
                  className={`flex-1 text-right ${
                    matchup.winner === 'team2'
                      ? 'font-bold text-[var(--success-text)]'
                      : 'text-[var(--foreground)]'
                  }`}
                >
                  <div className="text-lg">{matchup.team2.name}</div>
                  <div className="text-sm text-[var(--muted)]">
                    @{matchup.team2.username}
                  </div>

                  <div className="text-2xl font-bold mt-2">
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
                  {loadingId === `${matchup.week}:${matchup.matchupId}` ? 'Loading lineups…' : 'Tap for lineups'}
                </div>
              )}
            </button>
          ))
        )}
      </div>
      {detail && (
        <MatchupDetail
          title={`Week ${open.week}: ${detail.a.name} vs ${detail.b.name}`}
          a={detail.a}
          b={detail.b}
          slots={(leagueData?.league.roster_positions ?? []).filter((s) => s !== 'BN' && s !== 'IR')}
          footnote="Final points, with each player's Sleeper projection from before the games."
          onClose={close}
        />
      )}
    </div>
  );
}
