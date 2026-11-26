import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { SLEEPER_CONFIG, CACHE_CONFIG, FRESH_TAG } from '@/lib/config';
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
  rankTau,
  liveGameFor,
  type PlayoffOddsResponse,
} from '@/lib/analyze/playoffOdds';
import { liveWeekOdds } from '@/lib/liveWeek';
import { weeklyWinProbability } from '@/lib/analyze/trade';

export const dynamic = 'force-dynamic';

// Bump when the model or response shape changes: cached results outlive deploys
const CACHE_VERSION = 'v22'; // v22: gamePoints

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
    gamePoints:
      inputs.games && lastScoredWeek > 0
        ? (() => {
            const league = teams.reduce((t, x) => t + x.pointsFor, 0) / (teams.length * lastScoredWeek);
            return Object.fromEntries(
              Object.entries(inputs.games!.meanByWeek).map(([w, m]) => [w, Object.fromEntries(Object.entries(m).map(([id, v]) => [id, league + v]))])
            );
          })()
        : null,
    strength: inputs.fitted
      ? strengthRanks(
          Object.fromEntries(teams.map((t) => [t.rosterId, Object.values(inputs.fitted!.meanByWeek)[0]?.[t.rosterId] ?? 0])),
          rankTau(lastScoredWeek + 1)
        )
      : null,
    model: remaining.length ? { remaining, meanByWeek, spread, teamSpread } : null,
    remainingWeeks: inputs.remainingWeeks.length,
    projectionWeeks: inputs.projectionWeeks,
    generatedAt: new Date().toISOString(),
  };
}

/** The odds with the week being played's games at their live odds, once one has kicked off */
async function withLive(league: SleeperLeague, base: PlayoffOddsResponse): Promise<PlayoffOddsResponse['live']> {
  const model = base.model;
  const live = model ? await liveWeekOdds(league) : null;
  if (!model || !live || !model.remaining.some((g) => g.week === live.week)) return null;
  const run = unstable_cache(
    async () =>
      simulatePlayoffOdds(base.teams, model.remaining, base.format, model.meanByWeek, model.spread, 20000, 2026, base.playoffWeekStart, base.toiletBracket.length > 0, model.teamSpread, undefined, live.games),
    ['playoff-odds-live', CACHE_VERSION, league.league_id, String(live.week), live.fetchedAt]
  );
  return {
    week: live.week,
    games: live.games,
    odds: await run(),
    gameOdds: base.gameOdds?.map((g) => {
      const l = g.week === live.week ? liveGameFor(live.games, g.week, g.a, g.b) : null;
      return l ? { ...g, aWins: l.aWins } : g;
    }) ?? null,
    fetchedAt: live.fetchedAt,
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
      tags: [FRESH_TAG],
    });
    const base = await cached();
    return NextResponse.json({ ...base, live: base.status === 'in_progress' ? await withLive(league, base) : null });
  } catch (error) {
    console.error('Error building playoff odds:', error);
    return NextResponse.json({ error: 'Failed to build playoff odds' }, { status: 500 });
  }
}
