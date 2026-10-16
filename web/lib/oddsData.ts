/**
 * Server-side inputs for the playoff-odds model, shared by the playoff odds
 * and trade analyzer routes so both start from the same numbers.
 */

import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup, SleeperRoster } from '@/lib/types';
import {
  bestLineupPoints,
  teamStrength,
  type OddsTeam,
  type PlayoffFormat,
  type RemainingGame,
} from '@/lib/analyze/playoffOdds';

export const PROJECTIONS_URL = 'https://api.sleeper.com/projections/nfl';
export const SCHEDULE_URL = 'https://api.sleeper.com/schedule/nfl/regular';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export const fetchJson = async <T,>(url: string, revalidate: number | false): Promise<T> => {
  const response = await fetch(url, revalidate === false ? { cache: 'no-store' } : { next: { revalidate } });
  if (!response.ok) throw new Error(`Sleeper request failed (${response.status}): ${url}`);
  return response.json() as Promise<T>;
};

export interface ProjectedPlayer {
  position: string;
  points: number;
  name: string;
  team: string | null;
  injury: string | null;
}

interface ProjectionRow {
  player_id: string;
  player?: {
    position?: string;
    first_name?: string;
    last_name?: string;
    team?: string | null;
    injury_status?: string | null;
  };
  stats?: { pts_half_ppr?: number };
}

/**
 * Every player's half-PPR projection for one week (null if unavailable).
 * Too big for the fetch cache, so callers cache what they build from it.
 */
export async function weekProjections(season: string, week: number): Promise<Record<string, ProjectedPlayer> | null> {
  try {
    const query = POSITIONS.map((p) => `position%5B%5D=${p}`).join('&');
    const rows = await fetchJson<ProjectionRow[]>(`${PROJECTIONS_URL}/${season}/${week}?season_type=regular&${query}`, false);
    const out: Record<string, ProjectedPlayer> = {};
    for (const r of rows) {
      const position = r.player?.position;
      if (!position) continue;
      const name = position === 'DEF'
        ? `${r.player?.first_name ?? r.player_id} ${r.player?.last_name ?? ''}`.trim()
        : `${r.player?.first_name ?? ''} ${r.player?.last_name ?? ''}`.trim() || r.player_id;
      out[r.player_id] = {
        position,
        points: r.stats?.pts_half_ppr ?? 0,
        name,
        team: r.player?.team ?? null,
        injury: r.player?.injury_status ?? null,
      };
    }
    return out;
  } catch (error) {
    console.error(`Projections unavailable for ${season} week ${week}:`, error);
    return null;
  }
}

/** NFL teams playing each week, from Sleeper's schedule (null if unavailable) */
export async function teamsPlaying(season: string): Promise<Record<number, Set<string>> | null> {
  try {
    const games = await fetchJson<Array<{ week: number; home: string; away: string }>>(
      `${SCHEDULE_URL}/${season}`,
      CACHE_CONFIG.completedWeek
    );
    const out: Record<number, Set<string>> = {};
    for (const g of games) {
      out[g.week] ??= new Set();
      out[g.week].add(g.home);
      out[g.week].add(g.away);
    }
    return out;
  } catch (error) {
    console.error(`Schedule unavailable for ${season}:`, error);
    return null;
  }
}

export function playoffFormat(league: SleeperLeague): PlayoffFormat {
  const settings = league.settings ?? {};
  return { playoffTeams: settings.playoff_teams ?? 6, hasDivisions: (settings.divisions ?? 0) > 0, byes: 2 };
}

export interface OddsInputs {
  format: PlayoffFormat;
  lastScoredWeek: number;
  regularSeasonEnd: number;
  playoffWeekStart: number;
  rosters: SleeperRoster[];
  teams: OddsTeam[];
  remaining: RemainingGame[];
  remainingWeeks: number[];
  /** Remaining regular-season weeks plus the playoff weeks */
  strengthWeeks: number[];
  /** Weeks that had projections */
  projectionWeeks: number[];
  /** week -> every player's projection, for the weeks that had them */
  players: Record<number, Record<string, ProjectedPlayer>>;
  meanByWeek: Record<number, Record<number, number>>;
  spread: number;
  hasToiletBowl: boolean;
}

/** Current rosters, records, schedule, projections and team strength for the live season */
export async function loadOddsInputs(league: SleeperLeague): Promise<OddsInputs> {
  const { baseUrl } = SLEEPER_CONFIG;
  const id = league.league_id;
  const settings = league.settings ?? {};
  const lastScoredWeek = settings.last_scored_leg ?? 0;
  const playoffWeekStart = settings.playoff_week_start ?? 15;
  const regularSeasonEnd = playoffWeekStart - 1;
  const format = playoffFormat(league);

  const rosters = await fetchJson<SleeperRoster[]>(`${baseUrl}/league/${id}/rosters`, CACHE_CONFIG.leagueData);
  const teams: OddsTeam[] = rosters.map((r) => ({
    rosterId: r.roster_id,
    teamName: '',
    username: '',
    division: format.hasDivisions ? r.settings.division ?? 0 : 0,
    wins: r.settings.wins,
    losses: r.settings.losses,
    ties: r.settings.ties,
    pointsFor: r.settings.fpts + (r.settings.fpts_decimal ?? 0) / 100,
  }));

  const weeks = Array.from({ length: regularSeasonEnd }, (_, i) => i + 1);
  const matchups = await Promise.all(
    weeks.map((w) =>
      fetchJson<SleeperMatchup[]>(
        `${baseUrl}/league/${id}/matchups/${w}`,
        w <= lastScoredWeek ? CACHE_CONFIG.completedWeek : CACHE_CONFIG.leagueData
      )
    )
  );

  const weeklyScores: Record<number, number[]> = Object.fromEntries(teams.map((t) => [t.rosterId, [] as number[]]));
  const remaining: RemainingGame[] = [];
  matchups.forEach((week, i) => {
    const w = i + 1;
    if (w <= lastScoredWeek) {
      week.forEach((m) => weeklyScores[m.roster_id]?.push(m.points ?? 0));
      return;
    }
    const pairs = new Map<number, number[]>();
    week.forEach((m) => {
      if (m.matchup_id == null) return;
      pairs.set(m.matchup_id, [...(pairs.get(m.matchup_id) ?? []), m.roster_id]);
    });
    pairs.forEach((p) => {
      if (p.length === 2) remaining.push({ week: w, a: p[0], b: p[1] });
    });
  });

  // Each remaining week's projections, so byes only count in the week they happen;
  // the three playoff weeks too, for the championship and toilet bowl
  const remainingWeeks = [...new Set(remaining.map((g) => g.week))].sort((a, b) => a - b);
  const playoffWeeks = remaining.length ? [playoffWeekStart, playoffWeekStart + 1, playoffWeekStart + 2] : [];
  const strengthWeeks = [...remainingWeeks, ...playoffWeeks];
  const perWeek = await Promise.all(strengthWeeks.map((w) => weekProjections(league.season, w)));
  const players: Record<number, Record<string, ProjectedPlayer>> = {};
  const projections: Record<number, Record<number, number>> = {};
  const rosterPositions = league.roster_positions ?? [];
  strengthWeeks.forEach((w, i) => {
    const week = perWeek[i];
    if (!week) return;
    players[w] = week;
    projections[w] = Object.fromEntries(
      rosters.map((r) => [r.roster_id, bestLineupPoints(r.players ?? [], week, rosterPositions)])
    );
  });
  const projectionWeeks = Object.keys(projections).map(Number);
  const { meanByWeek, spread } = teamStrength(weeklyScores, strengthWeeks, projectionWeeks.length ? projections : null);

  // Sleeper only creates this season's losers bracket when the playoffs start,
  // so go by last season's league too
  const previous = league.previous_league_id
    ? await fetchJson<SleeperLeague>(`${baseUrl}/league/${league.previous_league_id}`, CACHE_CONFIG.completedWeek).catch(() => null)
    : null;
  const hasToiletBowl = !!league.loser_bracket_id || !!previous?.loser_bracket_id;

  return {
    format,
    lastScoredWeek,
    regularSeasonEnd,
    playoffWeekStart,
    rosters,
    teams,
    remaining,
    remainingWeeks,
    strengthWeeks,
    projectionWeeks,
    players,
    meanByWeek,
    spread,
    hasToiletBowl,
  };
}
