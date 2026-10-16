import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup, SleeperRoster } from '@/lib/types';
import {
  bestLineupPoints,
  playoffScenarios,
  pointsRaces,
  projectedBracket,
  seedTeams,
  simulatePlayoffOdds,
  teamStrength,
  type OddsTeam,
  type PlayoffFormat,
  type PlayoffOddsResponse,
  type RemainingGame,
} from '@/lib/analyze/playoffOdds';

export const dynamic = 'force-dynamic';

const PROJECTIONS_URL = 'https://api.sleeper.com/projections/nfl';
// Bump when the model or response shape changes: cached results outlive deploys
const CACHE_VERSION = 'v2';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const fetchJson = async <T,>(url: string, revalidate: number | false): Promise<T> => {
  const response = await fetch(url, revalidate === false ? { cache: 'no-store' } : { next: { revalidate } });
  if (!response.ok) throw new Error(`Sleeper request failed (${response.status}): ${url}`);
  return response.json() as Promise<T>;
};

/** Projected best lineup per roster for one week; null if projections aren't available */
async function rosterProjections(season: string, week: number, rosters: SleeperRoster[], rosterPositions: string[]) {
  try {
    const query = POSITIONS.map((p) => `position%5B%5D=${p}`).join('&');
    // Every player in the league: too big for the fetch cache, so the built result is cached instead
    const rows = await fetchJson<Array<{ player_id: string; player?: { position?: string }; stats?: { pts_half_ppr?: number } }>>(
      `${PROJECTIONS_URL}/${season}/${week}?season_type=regular&${query}`,
      false
    );
    const projections: Record<string, { position: string; points: number }> = {};
    for (const r of rows) {
      const position = r.player?.position;
      if (position) projections[r.player_id] = { position, points: r.stats?.pts_half_ppr ?? 0 };
    }
    const out: Record<number, number> = {};
    for (const roster of rosters) out[roster.roster_id] = bestLineupPoints(roster.players ?? [], projections, rosterPositions);
    return out;
  } catch (error) {
    console.error('Projections unavailable, using season form only:', error);
    return null;
  }
}

async function build(league: SleeperLeague): Promise<PlayoffOddsResponse> {
  const { baseUrl } = SLEEPER_CONFIG;
  const id = league.league_id;
  const settings = league.settings ?? {};
  const lastScoredWeek = settings.last_scored_leg ?? 0;
  const playoffWeekStart = settings.playoff_week_start ?? 15;
  const regularSeasonEnd = playoffWeekStart - 1;
  const format: PlayoffFormat = {
    playoffTeams: settings.playoff_teams ?? 6,
    hasDivisions: (settings.divisions ?? 0) > 0,
    byes: 2,
  };

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

  // Each remaining week's projections, so byes only count in the week they happen
  const remainingWeeks = [...new Set(remaining.map((g) => g.week))].sort((a, b) => a - b);
  const perWeek = await Promise.all(
    remainingWeeks.map((w) => rosterProjections(league.season, w, rosters, league.roster_positions ?? []))
  );
  const projections: Record<number, Record<number, number>> = {};
  remainingWeeks.forEach((w, i) => {
    if (perWeek[i]) projections[w] = perWeek[i]!;
  });
  const projectionWeeks = Object.keys(projections).map(Number);
  const { meanByWeek, spread } = teamStrength(weeklyScores, remainingWeeks, projectionWeeks.length ? projections : null);
  const { seeds, divisionWinners } = seedTeams(teams, format);
  const status = lastScoredWeek >= regularSeasonEnd ? 'complete' : lastScoredWeek === 0 ? 'not_started' : 'in_progress';

  return {
    status,
    season: league.season,
    lastScoredWeek,
    regularSeasonEnd,
    playoffWeekStart,
    format,
    teams,
    seeds,
    divisionWinners: [...divisionWinners],
    bracket: projectedBracket(seeds, playoffWeekStart),
    odds: remaining.length ? simulatePlayoffOdds(teams, remaining, format, meanByWeek, spread) : null,
    scenarios: playoffScenarios(teams, remaining, format),
    pointsRaces: pointsRaces(teams, format),
    remainingWeeks: remainingWeeks.length,
    projectionWeeks,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Playoff picture for the current season's regular season: seeds if it ended
 * now, simulated odds over the remaining schedule, and exact clinch /
 * elimination scenarios. Cached until the next week is scored (and at most
 * CACHE_CONFIG.playoffOdds seconds, so roster moves feed the projections).
 */
export async function GET() {
  try {
    const { leagueId, baseUrl } = SLEEPER_CONFIG;
    const league = await fetchJson<SleeperLeague>(`${baseUrl}/league/${leagueId}`, CACHE_CONFIG.leagueData);
    const lastScored = league.settings?.last_scored_leg ?? 0;
    const cached = unstable_cache(() => build(league), ['playoff-odds', CACHE_VERSION, league.league_id, String(lastScored)], {
      revalidate: CACHE_CONFIG.playoffOdds,
    });
    return NextResponse.json(await cached());
  } catch (error) {
    console.error('Error building playoff odds:', error);
    return NextResponse.json({ error: 'Failed to build playoff odds' }, { status: 500 });
  }
}
