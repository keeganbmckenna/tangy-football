/**
 * A season's player-level record, for the Rosters tab, the weekly awards and Season in
 * Review: every team's lineup each week (who started, what everyone on the roster scored,
 * the starters' projections, and the best lineup it could have started), and every waiver
 * claim and free-agent pickup with what it brought in. Built server-side by
 * lib/seasonInsights.ts (/api/season-insights/{season}); finished seasons are pre-built.
 */

import type { SleeperMatchup, SleeperTransaction } from '../types';
import { bestLineup } from './playoffOdds';

export interface InsightsPlayer {
  name: string;
  position: string;
  team: string | null;
}

export interface TeamWeek {
  week: number;
  /** The opponent's roster ID (null without a matchup) */
  opponent: number | null;
  points: number;
  opponentPoints: number | null;
  /** The best lineup the roster could have started, at the points everyone scored */
  optimal: number;
  /** The starters' projections from before the games (null without projections) */
  projected: number | null;
  starters: string[];
  /** What every player on the roster scored that week */
  playerPoints: Record<string, number>;
  /** Each starter's projection from before the games */
  starterProjections: Record<string, number>;
}

export interface WaiverMove {
  week: number;
  rosterId: number;
  playerId: string;
  type: 'waiver' | 'free_agent';
  /** FAAB bid (waiver claims in FAAB leagues) */
  bid: number | null;
  /** Bids that lost this player to this claim */
  losingBids: Array<{ rosterId: number; bid: number }>;
  dropped: string[];
  /** Points he scored in this roster's starting lineup from the week he joined it */
  startedPoints: number;
  startedWeeks: number;
}

export interface SeasonInsights {
  season: string;
  regularSeasonEnd: number;
  /** Regular-season weeks covered (1..weeks) */
  weeks: number;
  complete: boolean;
  /** FAAB each team started with (null without FAAB) */
  faabBudget: number | null;
  /** rosterId -> FAAB spent */
  faabUsed: Record<number, number>;
  players: Record<string, InsightsPlayer>;
  /** rosterId -> its weeks, in order */
  teams: Record<number, TeamWeek[]>;
  waivers: WaiverMove[];
  generatedAt: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Each team's week: its starters and their projections, every rostered player's points, and
 * the best lineup it could have started (positions from that week's projections)
 */
export function teamWeeksFor(
  week: number,
  matchups: SleeperMatchup[],
  projections: Record<string, { points: number }> | null,
  positions: Record<string, string>,
  rosterPositions: string[]
): Record<number, TeamWeek> {
  const out: Record<number, TeamWeek> = {};
  for (const m of matchups) {
    const playerPoints = m.players_points ?? {};
    const roster = m.players ?? Object.keys(playerPoints);
    const values: Record<string, { position: string; points: number }> = {};
    for (const id of roster) if (positions[id]) values[id] = { position: positions[id], points: playerPoints[id] ?? 0 };
    const starters = (m.starters ?? []).filter((id) => id && id !== '0');
    const starterProjections: Record<string, number> = {};
    if (projections) for (const id of starters) starterProjections[id] = projections[id]?.points ?? 0;
    const opponent = m.matchup_id ? matchups.find((o) => o.matchup_id === m.matchup_id && o.roster_id !== m.roster_id) ?? null : null;
    out[m.roster_id] = {
      week,
      opponent: opponent?.roster_id ?? null,
      points: m.points ?? 0,
      opponentPoints: opponent ? opponent.points ?? 0 : null,
      // Never below what it scored (a starter missing from the projections still counted)
      optimal: round2(Math.max(bestLineup(roster, values, rosterPositions).total, m.points ?? 0)),
      projected: projections ? round2(Object.values(starterProjections).reduce((s, v) => s + v, 0)) : null,
      starters,
      playerPoints: Object.fromEntries(roster.filter((id) => playerPoints[id] !== undefined).map((id) => [id, playerPoints[id]])),
      starterProjections,
    };
  }
  return out;
}

const CLAIMED_BY_ANOTHER = /claimed by another/i;

/**
 * Every completed waiver claim and free-agent add, with the bids it beat and what the
 * player scored in the new team's starting lineup afterwards
 */
export function waiverMoves(transactions: SleeperTransaction[], teams: Record<number, TeamWeek[]>): WaiverMove[] {
  const lost = transactions.filter((t) => t.type === 'waiver' && t.status === 'failed' && CLAIMED_BY_ANOTHER.test(t.metadata?.notes ?? ''));
  const moves: WaiverMove[] = [];
  for (const t of transactions) {
    if ((t.type !== 'waiver' && t.type !== 'free_agent') || t.status !== 'complete' || !t.adds) continue;
    for (const [playerId, rosterId] of Object.entries(t.adds)) {
      const bid = t.type === 'waiver' ? t.settings?.waiver_bid ?? null : null;
      const losingBids = t.type === 'waiver'
        ? lost
            .filter((l) => l.leg === t.leg && l.adds && playerId in l.adds && l.roster_ids[0] !== rosterId)
            .map((l) => ({ rosterId: l.roster_ids[0], bid: l.settings?.waiver_bid ?? 0 }))
            .sort((a, b) => b.bid - a.bid)
        : [];
      let startedPoints = 0;
      let startedWeeks = 0;
      for (const w of teams[rosterId] ?? []) {
        if (w.week < t.leg || !w.starters.includes(playerId)) continue;
        startedPoints += w.playerPoints[playerId] ?? 0;
        startedWeeks++;
      }
      moves.push({
        week: t.leg,
        rosterId,
        playerId,
        type: t.type,
        bid,
        losingBids,
        dropped: Object.entries(t.drops ?? {}).filter(([, r]) => r === rosterId).map(([id]) => id),
        startedPoints: round2(startedPoints),
        startedWeeks,
      });
    }
  }
  return moves.sort((a, b) => a.week - b.week);
}
