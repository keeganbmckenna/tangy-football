'use client';

import { useCallback, useState } from 'react';
import MatchupDetail, { type MatchupPlayer, type MatchupSide } from '@/components/MatchupDetail';
import type { MatchupPlayersData } from '@/app/api/matchup-players/route';
import { teamAvatarUrl } from '@/lib/analyze/teamIdentity';
import type { LeagueData } from '@/lib/types';

export interface LineupTeam {
  rosterId: number;
  name: string;
  points: number;
}

export interface LineupGame {
  week: number;
  a: LineupTeam;
  b: LineupTeam;
  /** Shown in the dialog's title, e.g. "Semifinal" */
  label?: string;
}

// Defenses' IDs are their team codes (one on bye has no projection to name it)
const isDefense = (id: string) => /^[A-Z]{2,3}$/.test(id);

/**
 * A completed game's lineups, slot by slot with the benches, from the season's matchups
 * and each week's player names and original projections (loaded on the first tap of that
 * week). Used by Overview's weekly matchups and the playoff brackets.
 */
export function useMatchupLineups(leagueData: LeagueData | null | undefined) {
  const [players, setPlayers] = useState<Record<string, MatchupPlayersData['players']>>({});
  const [open, setOpen] = useState<LineupGame | null>(null);
  // `${week}:${rosterId}` of the game whose lineups are loading
  const [loading, setLoading] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const season = leagueData?.league.season;

  const openLineups = async (game: LineupGame) => {
    const key = `${season}:${game.week}`;
    if (!players[key]) {
      setLoading(`${game.week}:${game.a.rosterId}`);
      try {
        const res = await fetch(`/api/matchup-players?season=${season}&week=${game.week}`);
        const json = res.ok ? ((await res.json()) as MatchupPlayersData) : { players: {} };
        setPlayers((all) => ({ ...all, [key]: json.players }));
      } catch {
        setPlayers((all) => ({ ...all, [key]: {} }));
      } finally {
        setLoading(null);
      }
    }
    setOpen(game);
  };

  const side = (week: number, team: LineupTeam): MatchupSide | null => {
    const sm = leagueData?.matchups[week]?.find((x) => x.roster_id === team.rosterId);
    if (!sm) return null;
    const info = players[`${season}:${week}`] ?? {};
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
      avatarUrl: teamAvatarUrl(leagueData, team.rosterId),
      score: team.points,
      sub: projected > 0 ? `projected ${projected.toFixed(1)}` : undefined,
      starters: starters.map((id) => (!id || id === '0' ? null : player(id))),
      bench: (sm.players ?? []).filter((id) => !starters.includes(id)).map(player).sort((x, y) => y.points - x.points),
    };
  };

  const a = open && side(open.week, open.a);
  const b = open && side(open.week, open.b);
  const dialog =
    open && a && b ? (
      <MatchupDetail
        title={`Week ${open.week}${open.label ? ` ${open.label}` : ''}: ${a.name} vs ${b.name}`}
        a={a}
        b={b}
        slots={(leagueData?.league.roster_positions ?? []).filter((s) => s !== 'BN' && s !== 'IR')}
        footnote="Final points, with each player's Sleeper projection from before the games."
        onClose={close}
      />
    ) : null;

  /** Whether a game's lineups are loading */
  const isLoading = (game: Pick<LineupGame, 'week' | 'a'>) => loading === `${game.week}:${game.a.rosterId}`;
  /** Whether the season has this week's lineups to show */
  const canOpen = (week: number) => !!leagueData?.matchups[week]?.some((m) => (m.starters?.length ?? 0) > 0);

  return { openLineups, isLoading, canOpen, dialog };
}
