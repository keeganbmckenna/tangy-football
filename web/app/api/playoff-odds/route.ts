import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague } from '@/lib/types';
import { fetchJson, loadOddsInputs } from '@/lib/oddsData';
import {
  playoffScenarios,
  pointsRaces,
  projectedBracket,
  projectedToiletBracket,
  seedTeams,
  toiletSeeds,
  simulatePlayoffOdds,
  strengthRanks,
  type PlayoffOddsResponse,
} from '@/lib/analyze/playoffOdds';
import { weeklyWinProbability } from '@/lib/analyze/trade';

export const dynamic = 'force-dynamic';

// Bump when the model or response shape changes: cached results outlive deploys
const CACHE_VERSION = 'v16';

async function build(league: SleeperLeague): Promise<PlayoffOddsResponse> {
  const inputs = await loadOddsInputs(league);
  const { format, teams, remaining, lastScoredWeek, regularSeasonEnd, playoffWeekStart, hasToiletBowl } = inputs;
  // The fitted model (fittedStrength); the earlier one only without projections
  const { meanByWeek, spread } = inputs.fitted ?? inputs;
  const teamSpread = inputs.fitted?.teamSpread ?? 0;
  const { seeds, divisionWinners } = seedTeams(teams, format);
  const toilet = toiletSeeds(teams, seeds);
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
    toiletSeeds: toilet,
    toiletBracket: hasToiletBowl ? projectedToiletBracket(toilet, playoffWeekStart) : [],
    odds: remaining.length
      ? simulatePlayoffOdds(teams, remaining, format, meanByWeek, spread, 20000, 2026, playoffWeekStart, hasToiletBowl, teamSpread)
      : null,
    previousModel:
      remaining.length && inputs.fitted
        ? Object.fromEntries(
            Object.values(
              simulatePlayoffOdds(teams, remaining, format, inputs.meanByWeek, inputs.spread, 20000, 2026, playoffWeekStart, hasToiletBowl).teams
            ).map((o) => [o.rosterId, { playoffs: o.playoffs, bye: o.bye, champion: o.champion }])
          )
        : null,
    scenarios: playoffScenarios(teams, remaining, format),
    pointsRaces: pointsRaces(teams, format),
    gameOdds: inputs.games
      ? remaining.map((g) => {
          const mean = inputs.games!.meanByWeek[g.week] ?? {};
          return { week: g.week, a: g.a, b: g.b, aWins: weeklyWinProbability(mean[g.a] ?? 0, mean[g.b] ?? 0, inputs.games!.spreadByWeek[g.week] ?? 25) };
        })
      : null,
    strength: inputs.fitted
      ? strengthRanks(
          Object.fromEntries(teams.map((t) => [t.rosterId, Object.values(inputs.fitted!.meanByWeek)[0]?.[t.rosterId] ?? 0])),
          teamSpread
        )
      : null,
    model: remaining.length ? { remaining, meanByWeek, spread, teamSpread } : null,
    remainingWeeks: inputs.remainingWeeks.length,
    projectionWeeks: inputs.projectionWeeks,
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
