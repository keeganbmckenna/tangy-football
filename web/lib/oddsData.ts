/**
 * Server-side inputs for the playoff-odds model, shared by the playoff odds
 * and trade analyzer routes so both start from the same numbers.
 */

import { backBy, INJURED, missedStreak } from './analyze/availability';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup, SleeperRoster } from '@/lib/types';
import {
  bestLineupPoints,
  streamValues,
  type Streams,
  playerValue,
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
  /** Projected points */
  points: number;
  name: string;
  team: string | null;
  injury: string | null;
  /** Defenses only: the projected stat line (points allowed, sacks, takeaways...) */
  stats?: Record<string, number>;
}

interface ProjectionRow {
  player_id: string;
  /** The player's team that week (player.team is his current one) */
  team?: string | null;
  player?: {
    position?: string;
    first_name?: string;
    last_name?: string;
    team?: string | null;
    injury_status?: string | null;
  };
  stats?: { pts_half_ppr?: number } & Record<string, number>;
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
        team: r.team ?? r.player?.team ?? null,
        injury: r.player?.injury_status ?? null,
        ...(position === 'DEF' && r.stats ? { stats: r.stats } : {}),
      };
    }
    return out;
  } catch (error) {
    console.error(`Projections unavailable for ${season} week ${week}:`, error);
    return null;
  }
}

export interface SeasonProduction {
  /** player ID -> half-PPR points this season */
  points: Record<string, number>;
  /** player ID -> games played this season */
  games: Record<string, number>;
  /** player ID -> the weeks he played */
  playedWeeks: Record<string, number[]>;
}

/**
 * Every player's half-PPR points and games played over weeks 1..throughWeek,
 * from Sleeper's weekly stats. Each week's stats are too big for the fetch
 * cache, so callers cache what they build from them.
 */
export async function seasonProduction(season: string, throughWeek: number): Promise<SeasonProduction> {
  const { baseUrl } = SLEEPER_CONFIG;
  const weeks = Array.from({ length: Math.max(throughWeek, 0) }, (_, i) => i + 1);
  const all = await Promise.all(
    weeks.map((w) =>
      fetchJson<Record<string, { pts_half_ppr?: number; gp?: number }>>(`${baseUrl}/stats/nfl/regular/${season}/${w}`, false).catch(
        (error) => {
          console.error(`Stats unavailable for ${season} week ${w}:`, error);
          return {} as Record<string, { pts_half_ppr?: number; gp?: number }>;
        }
      )
    )
  );
  return cumulativeProduction(all);
}

/** Season points and games from a list of weekly stats */
export function cumulativeProduction(weeks: Array<Record<string, { pts_half_ppr?: number; gp?: number }>>): SeasonProduction {
  const points: Record<string, number> = {};
  const games: Record<string, number> = {};
  const playedWeeks: Record<string, number[]> = {};
  weeks.forEach((week, i) => {
    for (const [id, s] of Object.entries(week)) {
      if (!s.gp) continue;
      points[id] = (points[id] ?? 0) + (s.pts_half_ppr ?? 0);
      games[id] = (games[id] ?? 0) + s.gp;
      (playedWeeks[id] ??= []).push(i + 1);
    }
  });
  return { points, games, playedWeeks };
}

/** A week's player values (playerValue) for lineup building */
export function weekValues(
  week: Record<string, ProjectedPlayer>,
  production: SeasonProduction
): Record<string, { position: string; points: number }> {
  const out: Record<string, { position: string; points: number }> = {};
  for (const [id, p] of Object.entries(week)) {
    out[id] = { position: p.position, points: playerValue(p.points, production.points[id] ?? 0, production.games[id] ?? 0) };
  }
  return out;
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
  /** week -> every player's value (projection blended with season production) */
  values: Record<number, Record<string, { position: string; points: number }>>;
  /** week -> that week's best free agents by position, which lineups stream from (see bestLineup) */
  streams: Record<number, Streams>;
  production: SeasonProduction;
  meanByWeek: Record<number, Record<number, number>>;
  spread: number;
  hasToiletBowl: boolean;
}

/**
 * Players who are out: Sleeper projects every later week as if they're back next week,
 * so scale each of those weeks by the chance they're back by then (availability.ts),
 * from how many games in a row they've missed. Left alone when Sleeper already has a
 * player out past next week (it then knows a timeline).
 */
export function discountInjured(
  values: Record<number, Record<string, { position: string; points: number }>>,
  players: Record<number, Record<string, ProjectedPlayer>>,
  production: SeasonProduction,
  schedule: Record<number, Set<string>>,
  lastScoredWeek: number,
  weeks: number[]
): void {
  const current = lastScoredWeek + 1;
  const now = players[current] ?? players[weeks[0]];
  if (!now) return;
  for (const [id, p] of Object.entries(now)) {
    if (!p.injury || !INJURED.has(p.injury) || !p.team) continue;
    const team = p.team;
    const teamWeeks = Array.from({ length: lastScoredWeek }, (_, i) => i + 1).filter((w) => schedule[w]?.has(team));
    let missed = missedStreak(teamWeeks, new Set(production.playedWeeks[id] ?? []));
    const plays = (w: number) => schedule[w]?.has(team);
    let games: number[];
    if (plays(current) && (values[current]?.[id]?.points ?? 0) === 0) {
      // Sleeper already has him out this week: that's one more game missed
      missed += 1;
      games = weeks.filter((w) => w > current && plays(w));
    } else if (p.injury === 'Doubtful') {
      // He may well play this week: only the weeks after are in doubt
      if (missed === 0) continue;
      games = weeks.filter((w) => w > current && plays(w));
    } else {
      // Ruled out, but early in the week Sleeper still projects him this week. One hurt in his
      // last game (played it, ruled out since: Mike Evans, week 6 of 2026) counts as having
      // missed one.
      missed = Math.max(missed, 1);
      games = weeks.filter((w) => w >= current && plays(w));
    }
    if (!games.length || (values[games[0]]?.[id]?.points ?? 0) === 0) continue;
    games.forEach((w, j) => {
      const v = values[w]?.[id];
      if (v) v.points *= backBy(missed, j + 1, p.injury === 'IR');
    });
  }
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
  const [perWeek, production, schedule] = await Promise.all([
    Promise.all(strengthWeeks.map((w) => weekProjections(league.season, w))),
    seasonProduction(league.season, lastScoredWeek),
    teamsPlaying(league.season),
  ]);
  const players: Record<number, Record<string, ProjectedPlayer>> = {};
  const values: Record<number, Record<string, { position: string; points: number }>> = {};
  const lineups: Record<number, Record<number, number>> = {};
  const rosterPositions = league.roster_positions ?? [];
  strengthWeeks.forEach((w, i) => {
    const week = perWeek[i];
    if (!week) return;
    players[w] = week;
    values[w] = weekValues(week, production);
  });
  if (schedule) discountInjured(values, players, production, schedule, lastScoredWeek, strengthWeeks);
  // Managers stream from waivers: kickers and defenses every week, and anyone to fill a slot
  // that would otherwise score nothing
  const rostered = new Set(rosters.flatMap((r) => r.players ?? []));
  const streams: Record<number, Streams> = {};
  for (const w of Object.keys(values).map(Number)) {
    streams[w] = streamValues(values[w], rostered);
    lineups[w] = Object.fromEntries(
      rosters.map((r) => [r.roster_id, bestLineupPoints(r.players ?? [], values[w], rosterPositions, streams[w])])
    );
  }
  const projectionWeeks = Object.keys(lineups).map(Number);
  const { meanByWeek, spread } = teamStrength(weeklyScores, strengthWeeks, projectionWeeks.length ? lineups : null);

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
    values,
    streams,
    production,
    meanByWeek,
    spread,
    hasToiletBowl,
  };
}
