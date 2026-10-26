import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague } from '@/lib/types';
import { fetchJson, loadOddsInputs, teamsPlaying } from '@/lib/oddsData';
import { earlierTradeModel, type TradeDataResponse, type TradeInputs, type TradePlayerInfo } from '@/lib/analyze/trade';

export const dynamic = 'force-dynamic';

// Bump when the response shape changes: cached results outlive deploys
const CACHE_VERSION = 'v10';
const FANTASYCALC_URL = 'https://api.fantasycalc.com/values/current';
/** Free agents per position offered as pickups for roster spots a trade opens */
const FREE_AGENTS_PER_POSITION = 15;

/**
 * FantasyCalc redraft values for the league's format, keyed by Sleeper player ID.
 * FantasyCalc doesn't document this endpoint; on any failure the analyzer
 * simply shows no market values.
 */
async function marketValues(league: SleeperLeague): Promise<Record<string, number> | null> {
  try {
    const positions = league.roster_positions ?? [];
    const numQbs = positions.filter((p) => p === 'QB' || p === 'SUPER_FLEX').length >= 2 ? 2 : 1;
    const params = new URLSearchParams({
      isDynasty: 'false',
      numQbs: String(numQbs),
      numTeams: String(league.settings?.num_teams ?? 12),
      ppr: String(league.scoring_settings?.rec ?? 0.5),
    });
    const rows = await fetchJson<Array<{ player?: { sleeperId?: string }; redraftValue?: number; value?: number }>>(
      `${FANTASYCALC_URL}?${params}`,
      CACHE_CONFIG.marketValues
    );
    const out: Record<string, number> = {};
    for (const r of rows) {
      const id = r.player?.sleeperId;
      const value = r.redraftValue ?? r.value;
      if (id && typeof value === 'number') out[id] = value;
    }
    return out;
  } catch (error) {
    console.error('FantasyCalc values unavailable:', error);
    return null;
  }
}

async function build(league: SleeperLeague): Promise<TradeDataResponse> {
  const [odds, values, schedule] = await Promise.all([loadOddsInputs(league), marketValues(league), teamsPlaying(league.season)]);
  const settings = league.settings ?? {};
  const currentWeek = settings.leg ?? 0;
  const tradeDeadline = settings.trade_deadline ?? 0;

  // Expected points (projection blended with season production, as the odds
  // model values players) for every rostered player and the best free agents
  const rostered = new Set(odds.rosters.flatMap((r) => r.players ?? []));
  const weeks = odds.projectionWeeks.sort((a, b) => a - b);
  const regularWeeks = weeks.filter((w) => w <= odds.regularSeasonEnd);
  const total = (id: string) => regularWeeks.reduce((s, w) => s + (odds.values[w]?.[id]?.points ?? 0), 0);
  const known = new Map<string, { position: string; name: string; team: string | null; injury: string | null }>();
  for (const w of weeks) {
    for (const [id, p] of Object.entries(odds.players[w] ?? {})) {
      if (!known.has(id)) known.set(id, p);
    }
  }
  const freeAgents: string[] = [];
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    const pool = [...known.entries()]
      .filter(([id, p]) => p.position === position && !rostered.has(id))
      .map(([id]) => ({ id, total: total(id) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, FREE_AGENTS_PER_POSITION);
    freeAgents.push(...pool.map((p) => p.id));
  }

  // Each NFL team's bye among the remaining regular-season weeks
  const byeWeek = (team: string | null) => {
    if (!team || !schedule) return null;
    return regularWeeks.find((w) => schedule[w] && !schedule[w].has(team)) ?? null;
  };

  const wanted = [...rostered, ...freeAgents];
  const projections: TradeInputs['projections'] = {};
  const positions: TradeInputs['positions'] = {};
  const players: Record<string, TradePlayerInfo> = {};
  for (const id of wanted) {
    const info = known.get(id);
    if (!info) continue;
    positions[id] = info.position;
    projections[id] = Object.fromEntries(
      weeks.map((w) => [w, Math.round((odds.values[w]?.[id]?.points ?? 0) * 100) / 100])
    );
    const games = odds.production.games[id] ?? 0;
    players[id] = {
      id,
      name: info.name,
      position: info.position,
      team: info.team,
      injury: info.injury,
      expectedPerWeek: regularWeeks.length ? Math.round((total(id) / regularWeeks.length) * 10) / 10 : 0,
      seasonPerGame: games ? Math.round(((odds.production.points[id] ?? 0) / games) * 10) / 10 : null,
      value: values?.[id] ?? null,
      byeWeek: byeWeek(info.position === 'DEF' ? id : info.team),
    };
  }

  const open =
    odds.remaining.length > 0 &&
    league.status === 'in_season' &&
    (tradeDeadline === 0 || currentWeek <= tradeDeadline);

  return {
    open,
    season: league.season,
    currentWeek,
    tradeDeadline,
    regularSeasonEnd: odds.regularSeasonEnd,
    playoffWeekStart: odds.playoffWeekStart,
    format: odds.format,
    hasToiletBowl: odds.hasToiletBowl,
    teams: odds.teams,
    remaining: odds.remaining,
    meanByWeek: odds.meanByWeek,
    spread: odds.spread,
    model:
      odds.fitted && odds.games
        ? {
            season: { meanByWeek: odds.fitted.meanByWeek, spread: odds.fitted.spread, teamSpread: odds.fitted.teamSpread, lineupWeight: odds.fitted.lineupWeight },
            games: odds.games,
          }
        : earlierTradeModel(odds.meanByWeek, odds.spread, odds.lastScoredWeek, odds.remainingWeeks),
    inputs: {
      weeks,
      projections,
      positions,
      rosters: Object.fromEntries(odds.rosters.map((r) => [r.roster_id, r.players ?? []])),
      reserve: Object.fromEntries(odds.rosters.map((r) => [r.roster_id, r.reserve ?? []])),
      freeAgents,
      rosterPositions: league.roster_positions ?? [],
      lastScoredWeek: odds.lastScoredWeek,
    },
    players,
    marketValues: values !== null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Trade analyzer inputs for the current season: rosters, per-player weekly
 * projections, the playoff model's expected scores and FantasyCalc values.
 * The analyzer runs in the browser from these.
 */
export async function GET() {
  try {
    const { leagueId, baseUrl } = SLEEPER_CONFIG;
    const league = await fetchJson<SleeperLeague>(`${baseUrl}/league/${leagueId}`, CACHE_CONFIG.leagueData);
    const lastScored = league.settings?.last_scored_leg ?? 0;
    const cached = unstable_cache(() => build(league), ['trade-data', CACHE_VERSION, league.league_id, String(lastScored)], {
      revalidate: CACHE_CONFIG.tradeData,
    });
    return NextResponse.json(await cached());
  } catch (error) {
    console.error('Error building trade data:', error);
    return NextResponse.json({ error: 'Failed to build trade data' }, { status: 500 });
  }
}
