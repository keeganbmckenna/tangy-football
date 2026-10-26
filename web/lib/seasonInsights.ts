/**
 * Server-side season insights (lib/analyze/insights.ts) for /api/season-insights/{season}:
 * every regular-season week's matchups, that week's projections (for positions, names and
 * the starters' projections) and the season's waiver and free-agent moves.
 */

import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup, SleeperRoster, SleeperTransaction } from '@/lib/types';
import { fetchJson, weekProjections } from '@/lib/oddsData';
import { teamWeeksFor, waiverMoves, type InsightsPlayer, type SeasonInsights, type TeamWeek } from '@/lib/analyze/insights';

export async function buildSeasonInsights(league: SleeperLeague): Promise<SeasonInsights> {
  const { baseUrl } = SLEEPER_CONFIG;
  const id = league.league_id;
  const settings = league.settings ?? {};
  const regularSeasonEnd = (settings.playoff_week_start ?? 15) - 1;
  const lastScoredWeek = Math.min(settings.last_scored_leg ?? 0, regularSeasonEnd);
  const weeks = Array.from({ length: lastScoredWeek }, (_, i) => i + 1);
  const revalidate = (w: number) => (w <= lastScoredWeek ? CACHE_CONFIG.completedWeek : CACHE_CONFIG.leagueData);

  const [matchupList, projectionList, transactions, rosters] = await Promise.all([
    Promise.all(weeks.map((w) => fetchJson<SleeperMatchup[]>(`${baseUrl}/league/${id}/matchups/${w}`, revalidate(w)))),
    Promise.all(weeks.map((w) => weekProjections(league.season, w))),
    // Moves through the last regular-season week (the next week's claims can come before its games)
    Promise.all(
      Array.from({ length: Math.min(lastScoredWeek + 1, regularSeasonEnd) }, (_, i) =>
        fetchJson<SleeperTransaction[]>(`${baseUrl}/league/${id}/transactions/${i + 1}`, revalidate(i + 1)).catch(() => [] as SleeperTransaction[])
      )
    ),
    fetchJson<SleeperRoster[]>(`${baseUrl}/league/${id}/rosters`, CACHE_CONFIG.leagueData),
  ]);

  // Names and positions: each player's latest projection row
  const players: Record<string, InsightsPlayer> = {};
  for (const proj of projectionList) {
    for (const [pid, p] of Object.entries(proj ?? {})) players[pid] = { name: p.name, position: p.position, team: p.team };
  }
  const positions = Object.fromEntries(Object.entries(players).map(([pid, p]) => [pid, p.position]));

  const teams: Record<number, TeamWeek[]> = Object.fromEntries(rosters.map((r) => [r.roster_id, [] as TeamWeek[]]));
  weeks.forEach((w, i) => {
    const byRoster = teamWeeksFor(w, matchupList[i] ?? [], projectionList[i], positions, league.roster_positions ?? []);
    for (const [rid, tw] of Object.entries(byRoster)) (teams[Number(rid)] ??= []).push(tw);
  });

  // Only the players who appear anywhere, to keep the response small
  const used = new Set<string>();
  for (const list of Object.values(teams)) for (const w of list) Object.keys(w.playerPoints).forEach((pid) => used.add(pid));
  const moves = waiverMoves(transactions.flat(), teams);
  for (const m of moves) {
    used.add(m.playerId);
    m.dropped.forEach((pid) => used.add(pid));
  }

  const budget = settings.waiver_budget ?? 0;
  return {
    season: league.season,
    regularSeasonEnd,
    weeks: lastScoredWeek,
    complete: lastScoredWeek >= regularSeasonEnd,
    faabBudget: budget > 0 ? budget : null,
    faabUsed: Object.fromEntries(rosters.map((r) => [r.roster_id, r.settings.waiver_budget_used ?? 0])),
    players: Object.fromEntries([...used].filter((pid) => players[pid]).map((pid) => [pid, players[pid]])),
    teams,
    waivers: moves,
    generatedAt: new Date().toISOString(),
  };
}
