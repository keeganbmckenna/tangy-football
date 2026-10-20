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
  type PlayoffOddsResponse,
} from '@/lib/analyze/playoffOdds';

export const dynamic = 'force-dynamic';

// Bump when the model or response shape changes: cached results outlive deploys
const CACHE_VERSION = 'v13';

async function build(league: SleeperLeague): Promise<PlayoffOddsResponse> {
  const inputs = await loadOddsInputs(league);
  const { format, teams, remaining, lastScoredWeek, regularSeasonEnd, playoffWeekStart, meanByWeek, spread, hasToiletBowl } = inputs;
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
      ? simulatePlayoffOdds(teams, remaining, format, meanByWeek, spread, 20000, 2026, playoffWeekStart, hasToiletBowl)
      : null,
    scenarios: playoffScenarios(teams, remaining, format),
    pointsRaces: pointsRaces(teams, format),
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
