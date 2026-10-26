/**
 * How each team's odds moved through a season: the playoff-odds model re-run as of the draft
 * and after every completed regular-season week, with only what was known then.
 *
 * Each checkpoint uses that time's rosters (the drafted rosters, then each week's), records and
 * weekly scores so far, each player's season production so far, and the projections published
 * for the next week, carried forward to later weeks with each NFL team's byes (as the model was
 * backtested and as the trade grades are made). Injury statuses from back then aren't kept, so
 * past checkpoints don't discount injured players; the Playoffs tab's live odds do.
 */

import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup, SleeperRoster } from '@/lib/types';
import {
  cumulativeProduction,
  fetchJson,
  playoffFormat,
  teamsPlaying,
  weekProjections,
  type ProjectedPlayer,
} from '@/lib/oddsData';
import {
  bestLineupPoints,
  fittedStrength,
  playerValue,
  simulatePlayoffOdds,
  teamStrength,
  type OddsTeam,
} from '@/lib/analyze/playoffOdds';
import { gamesFrom, record } from '@/lib/tradeHistory';

/** Fewer runs than the live odds: a season has up to 15 checkpoints (±1 point at 10,000) */
const HISTORY_SIMS = 10000;

/** The outcomes the chart can show, per team */
export interface OddsSnapshot {
  playoffs: number;
  division: number;
  bye: number;
  champion: number | null;
  lastPlace: number | null;
  toiletBye: number | null;
}

export interface OddsCheckpoint {
  /** Weeks completed: 0 is right after the draft */
  week: number;
  /** rosterId -> odds */
  odds: Record<number, OddsSnapshot>;
  /** rosterId -> the model's expected weekly score then (power rankings); missing in older files */
  strength?: Record<number, number>;
}

/** /api/odds-history/{season} */
export interface OddsHistoryResponse {
  season: string;
  /** Regular-season length, so the chart's axis covers the whole season */
  regularSeasonEnd: number;
  hasDivisions: boolean;
  hasToiletBowl: boolean;
  complete: boolean;
  checkpoints: OddsCheckpoint[];
  generatedAt: string;
}

export async function buildOddsHistory(league: SleeperLeague): Promise<OddsHistoryResponse> {
  const { baseUrl } = SLEEPER_CONFIG;
  const id = league.league_id;
  const settings = league.settings ?? {};
  const playoffWeekStart = settings.playoff_week_start ?? 15;
  const regularSeasonEnd = playoffWeekStart - 1;
  const lastScoredWeek = Math.min(settings.last_scored_leg ?? 0, regularSeasonEnd);
  const complete = lastScoredWeek >= regularSeasonEnd;
  const format = playoffFormat(league);
  const weeks = Array.from({ length: regularSeasonEnd }, (_, i) => i + 1);
  const revalidate = (w: number) => (w <= lastScoredWeek ? CACHE_CONFIG.completedWeek : CACHE_CONFIG.leagueData);

  const [matchupList, rosters, picks, schedule] = await Promise.all([
    Promise.all(weeks.map((w) => fetchJson<SleeperMatchup[]>(`${baseUrl}/league/${id}/matchups/${w}`, revalidate(w)))),
    fetchJson<SleeperRoster[]>(`${baseUrl}/league/${id}/rosters`, CACHE_CONFIG.leagueData),
    league.draft_id
      ? fetchJson<Array<{ player_id: string; roster_id: number }>>(`${baseUrl}/draft/${league.draft_id}/picks`, CACHE_CONFIG.completedWeek).catch(() => [])
      : Promise.resolve([] as Array<{ player_id: string; roster_id: number }>),
    teamsPlaying(league.season),
  ]);
  const matchups: Record<number, SleeperMatchup[]> = Object.fromEntries(weeks.map((w, i) => [w, matchupList[i]]));
  const division = new Map(rosters.map((r) => [r.roster_id, format.hasDivisions ? r.settings.division ?? 0 : 0]));

  // Sleeper only creates a losers bracket once the playoffs start, so a season in progress goes by last season's
  const previous = !complete && league.previous_league_id
    ? await fetchJson<SleeperLeague>(`${baseUrl}/league/${league.previous_league_id}`, CACHE_CONFIG.completedWeek).catch(() => null)
    : null;
  const hasToiletBowl = !!league.loser_bracket_id || !!previous?.loser_bracket_id;

  // Checkpoints: the draft (0 weeks played), then after each completed regular-season week
  const checkpointWeeks = Array.from({ length: lastScoredWeek + 1 }, (_, k) => k);
  const [projectionList, weeklyStats] = await Promise.all([
    Promise.all(checkpointWeeks.map((k) => weekProjections(league.season, Math.min(k + 1, regularSeasonEnd)))),
    Promise.all(
      Array.from({ length: lastScoredWeek }, (_, i) =>
        fetchJson<Record<string, { pts_half_ppr?: number; gp?: number }>>(`${baseUrl}/stats/nfl/regular/${league.season}/${i + 1}`, false).catch(
          () => ({}) as Record<string, { pts_half_ppr?: number; gp?: number }>
        )
      )
    ),
  ]);

  // Rosters at each checkpoint: the drafted rosters, then the rosters each next week was played with
  const drafted = new Map<number, string[]>();
  for (const p of picks) if (p.roster_id != null && p.player_id) drafted.set(p.roster_id, [...(drafted.get(p.roster_id) ?? []), p.player_id]);
  const rostersAt = (k: number) =>
    new Map(
      rosters.map((r) => {
        if (k === 0 && drafted.size) return [r.roster_id, drafted.get(r.roster_id) ?? []];
        const next = matchups[Math.min(k + 1, regularSeasonEnd)]?.find((m) => m.roster_id === r.roster_id)?.players;
        return [r.roster_id, next?.length ? next : r.players ?? []];
      })
    );
  const rosterPositions = league.roster_positions ?? [];

  const checkpoints: OddsCheckpoint[] = [];
  for (const k of checkpointWeeks) {
    const proj = projectionList[k];
    if (!proj) continue;
    const remaining = gamesFrom(matchups, k + 1, regularSeasonEnd);
    const regularWeeks = [...new Set(remaining.map((g) => g.week))];
    const strengthWeeks = [...regularWeeks, playoffWeekStart, playoffWeekStart + 1, playoffWeekStart + 2];
    const production = cumulativeProduction(weeklyStats.slice(0, k));
    const plays = (p: ProjectedPlayer, pid: string, w: number) => {
      const playing = schedule?.[w];
      if (!playing) return true;
      return p.position === 'DEF' ? playing.has(pid) : !!p.team && playing.has(p.team);
    };
    const values = (w: number) => {
      const out: Record<string, { position: string; points: number }> = {};
      for (const [pid, p] of Object.entries(proj)) {
        out[pid] = { position: p.position, points: playerValue(plays(p, pid, w) ? p.points : 0, production.points[pid] ?? 0, production.games[pid] ?? 0) };
      }
      return out;
    };
    const roster = rostersAt(k);
    const lineups: Record<number, Record<number, number>> = {};
    for (const w of strengthWeeks) {
      const v = values(w);
      lineups[w] = Object.fromEntries(rosters.map((r) => [r.roster_id, bestLineupPoints(roster.get(r.roster_id) ?? [], v, rosterPositions)]));
    }
    const teams: OddsTeam[] = rosters.map((r) => {
      const rec = record(matchups, r.roster_id, k);
      return { rosterId: r.roster_id, teamName: '', username: '', division: division.get(r.roster_id) ?? 0, ...rec };
    });
    const weeklyScores = Object.fromEntries(rosters.map((r) => [r.roster_id, record(matchups, r.roster_id, k).scores]));
    const fitted = fittedStrength(weeklyScores, strengthWeeks, regularWeeks, lineups, k + 1);
    const { meanByWeek, spread } = fitted ?? teamStrength(weeklyScores, strengthWeeks, lineups);
    const result = simulatePlayoffOdds(
      teams, remaining, format, meanByWeek, spread, HISTORY_SIMS, 2026, playoffWeekStart, hasToiletBowl, fitted?.teamSpread ?? 0
    );
    const firstWeek = meanByWeek[strengthWeeks[0]] ?? {};
    checkpoints.push({
      week: k,
      strength: Object.fromEntries(rosters.map((r) => [r.roster_id, Math.round((firstWeek[r.roster_id] ?? 0) * 100) / 100])),
      odds: Object.fromEntries(
        Object.values(result.teams).map((o) => [
          o.rosterId,
          { playoffs: o.playoffs, division: o.division, bye: o.bye, champion: o.champion, lastPlace: o.lastPlace, toiletBye: o.toiletBye },
        ])
      ),
    });
  }

  return {
    season: league.season,
    regularSeasonEnd,
    hasDivisions: format.hasDivisions,
    hasToiletBowl,
    complete,
    checkpoints,
    generatedAt: new Date().toISOString(),
  };
}
