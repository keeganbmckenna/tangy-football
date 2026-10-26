/**
 * The Rosters tab's analytics, from a season's insights (insights.ts): lineup decisions,
 * scoring against projections, where each team's points come from, the top players, and
 * what waiver pickups brought in.
 */

import type { SeasonInsights, TeamWeek, WaiverMove } from './insights';
import { bestLineup, SLOT_POSITIONS } from './playoffOdds';

const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

// ---------------------------------------------------------------------------
// Lineup decisions

export interface LineupSwap {
  /** Benched player who should have started */
  in: string;
  /** Starter he'd have replaced */
  out: string;
  gain: number;
}

export interface CostlyWeek {
  week: number;
  opponent: number | null;
  points: number;
  optimal: number;
  opponentPoints: number | null;
  /** The optimal lineup would have won it */
  flipped: boolean;
  swaps: LineupSwap[];
}

export interface LineupEfficiency {
  rosterId: number;
  points: number;
  optimal: number;
  /** points / optimal */
  efficiency: number;
  /** Points the best lineup would have added */
  leftOnBench: number;
  /** Losses the best lineup would have won */
  flippedLosses: number;
  /** Weeks it started the best possible lineup */
  perfectWeeks: number;
  weeks: number;
  /** The week its lineup cost it the most (losses the best lineup would have won first) */
  costliest: CostlyWeek | null;
}

/** Which benched players should have started, and for whom: the best lineup's players against the real starters */
export function lineupSwaps(
  w: TeamWeek,
  positions: Record<string, string>,
  rosterPositions: string[]
): LineupSwap[] {
  const values: Record<string, { position: string; points: number }> = {};
  for (const [id, pts] of Object.entries(w.playerPoints)) if (positions[id]) values[id] = { position: positions[id], points: pts };
  const best = bestLineup(Object.keys(w.playerPoints), values, rosterPositions).starters.map((s) => s.playerId);
  const started = new Set(w.starters);
  const ins = best.filter((id) => !started.has(id)).sort((a, b) => (w.playerPoints[b] ?? 0) - (w.playerPoints[a] ?? 0));
  // Starters fill the lineup slots in order, so each one's slot is known
  const slots = rosterPositions.filter((s) => !['BN', 'IR', 'TAXI'].includes(s));
  const outs = w.starters
    .map((id, i) => ({ id, slot: slots[i] ?? '' }))
    .filter((o) => !best.includes(o.id))
    .sort((a, b) => (w.playerPoints[a.id] ?? 0) - (w.playerPoints[b.id] ?? 0));
  const swaps: LineupSwap[] = [];
  for (const id of ins) {
    // The same position first, then any starter whose slot he could have filled
    const pos = positions[id];
    const i = [
      outs.findIndex((o) => positions[o.id] === pos),
      outs.findIndex((o) => (SLOT_POSITIONS[o.slot] ?? [o.slot]).includes(pos)),
      outs.length ? 0 : -1,
    ].find((x) => x >= 0);
    if (i === undefined) break;
    const [out] = outs.splice(i, 1);
    swaps.push({ in: id, out: out.id, gain: (w.playerPoints[id] ?? 0) - (w.playerPoints[out.id] ?? 0) });
  }
  return swaps;
}

export function lineupEfficiency(insights: SeasonInsights, rosterPositions: string[]): LineupEfficiency[] {
  const positions = Object.fromEntries(Object.entries(insights.players).map(([id, p]) => [id, p.position]));
  return Object.entries(insights.teams).map(([rid, weeks]) => {
    const points = sum(weeks.map((w) => w.points));
    const optimal = sum(weeks.map((w) => w.optimal));
    const flippedWeeks = weeks.filter((w) => w.opponentPoints !== null && w.points < w.opponentPoints && w.optimal > w.opponentPoints);
    const pool = flippedWeeks.length ? flippedWeeks : weeks;
    const worst = pool.reduce<TeamWeek | null>((m, w) => (!m || w.optimal - w.points > m.optimal - m.points ? w : m), null);
    return {
      rosterId: Number(rid),
      points,
      optimal,
      efficiency: optimal > 0 ? points / optimal : 1,
      leftOnBench: optimal - points,
      flippedLosses: flippedWeeks.length,
      perfectWeeks: weeks.filter((w) => w.optimal - w.points < 0.01).length,
      weeks: weeks.length,
      costliest:
        worst && worst.optimal - worst.points >= 0.01
          ? {
              week: worst.week,
              opponent: worst.opponent,
              points: worst.points,
              optimal: worst.optimal,
              opponentPoints: worst.opponentPoints,
              flipped: flippedWeeks.includes(worst),
              swaps: lineupSwaps(worst, positions, rosterPositions),
            }
          : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Against projections

export interface PlayerVsProjection {
  playerId: string;
  points: number;
  projected: number;
  /** points - projected while he started */
  diff: number;
  starts: number;
}

export interface TeamVsProjections {
  rosterId: number;
  points: number;
  projected: number;
  /** Week by week: actual - projected, and the running total */
  byWeek: Array<{ week: number; diff: number; cumulative: number }>;
  /** Its starters, most over their projections first */
  players: PlayerVsProjection[];
}

export function vsProjections(insights: SeasonInsights): TeamVsProjections[] {
  return Object.entries(insights.teams).map(([rid, weeks]) => {
    let cumulative = 0;
    const byWeek = weeks
      .filter((w) => w.projected !== null)
      .map((w) => {
        const diff = w.points - (w.projected ?? 0);
        cumulative += diff;
        return { week: w.week, diff, cumulative };
      });
    const players = new Map<string, PlayerVsProjection>();
    for (const w of weeks) {
      for (const id of w.starters) {
        if (w.starterProjections[id] === undefined) continue;
        const p = players.get(id) ?? { playerId: id, points: 0, projected: 0, diff: 0, starts: 0 };
        p.points += w.playerPoints[id] ?? 0;
        p.projected += w.starterProjections[id];
        p.diff = p.points - p.projected;
        p.starts++;
        players.set(id, p);
      }
    }
    const projectedWeeks = weeks.filter((w) => w.projected !== null);
    return {
      rosterId: Number(rid),
      points: sum(projectedWeeks.map((w) => w.points)),
      projected: sum(projectedWeeks.map((w) => w.projected ?? 0)),
      byWeek,
      players: [...players.values()].sort((a, b) => b.diff - a.diff),
    };
  });
}

// ---------------------------------------------------------------------------
// Where the points come from

export const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

export interface PositionPoints {
  rosterId: number;
  /** Starters' points by position */
  byPosition: Record<string, number>;
  total: number;
  /** Its top scorer (points while started) and his share of its starters' points */
  top: { playerId: string; points: number; share: number } | null;
}

export function positionPoints(insights: SeasonInsights): PositionPoints[] {
  return Object.entries(insights.teams).map(([rid, weeks]) => {
    const byPosition: Record<string, number> = {};
    const byPlayer = new Map<string, number>();
    for (const w of weeks) {
      for (const id of w.starters) {
        const pts = w.playerPoints[id] ?? 0;
        const pos = insights.players[id]?.position ?? 'Other';
        byPosition[pos] = (byPosition[pos] ?? 0) + pts;
        byPlayer.set(id, (byPlayer.get(id) ?? 0) + pts);
      }
    }
    const total = sum(Object.values(byPosition));
    const [topId, topPts] = [...byPlayer.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return { rosterId: Number(rid), byPosition, total, top: topId ? { playerId: topId, points: topPts, share: total > 0 ? topPts / total : 0 } : null };
  });
}

// ---------------------------------------------------------------------------
// Players

export interface PlayerSeason {
  playerId: string;
  /** Points while in a fantasy starting lineup */
  started: number;
  starts: number;
  /** The rosters he started for, most points first */
  rosters: number[];
  /** rosterId -> his points in its starting lineup */
  byRoster: Record<number, number>;
}

export interface PlayerGame {
  playerId: string;
  rosterId: number;
  week: number;
  points: number;
}

export function playerLeaders(insights: SeasonInsights): { seasons: PlayerSeason[]; games: PlayerGame[] } {
  const seasons = new Map<string, Omit<PlayerSeason, 'rosters' | 'byRoster'> & { byRoster: Map<number, number> }>();
  const games: PlayerGame[] = [];
  for (const [rid, weeks] of Object.entries(insights.teams)) {
    for (const w of weeks) {
      for (const id of w.starters) {
        const pts = w.playerPoints[id] ?? 0;
        const s = seasons.get(id) ?? { playerId: id, started: 0, starts: 0, byRoster: new Map<number, number>() };
        s.started += pts;
        s.starts++;
        s.byRoster.set(Number(rid), (s.byRoster.get(Number(rid)) ?? 0) + pts);
        seasons.set(id, s);
        games.push({ playerId: id, rosterId: Number(rid), week: w.week, points: pts });
      }
    }
  }
  return {
    seasons: [...seasons.values()]
      .map(({ byRoster, ...s }) => ({
        ...s,
        rosters: [...byRoster.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r),
        byRoster: Object.fromEntries(byRoster),
      }))
      .sort((a, b) => b.started - a.started),
    games: games.sort((a, b) => b.points - a.points),
  };
}

/** Each team's MVP: the player who scored the most in its starting lineup */
export function teamMvps(seasons: PlayerSeason[]): Map<number, { playerId: string; points: number }> {
  const out = new Map<number, { playerId: string; points: number }>();
  for (const s of seasons) {
    for (const [rid, pts] of Object.entries(s.byRoster)) {
      const best = out.get(Number(rid));
      if (!best || pts > best.points) out.set(Number(rid), { playerId: s.playerId, points: pts });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Waivers

export interface WaiverTeam {
  rosterId: number;
  moves: number;
  /** FAAB spent (Sleeper's own figure, which counts FAAB traded in) */
  spent: number;
  /** Points his pickups scored in its starting lineup */
  startedPoints: number;
}

/** Whether a season used FAAB bids (some leagues set a budget but bid nothing) */
export const usedFaab = (insights: SeasonInsights) => insights.faabBudget !== null && insights.waivers.some((m) => (m.bid ?? 0) > 0);

export function waiverTeams(insights: SeasonInsights): WaiverTeam[] {
  const out = new Map<number, WaiverTeam>(
    Object.keys(insights.teams).map((r) => [Number(r), { rosterId: Number(r), moves: 0, spent: insights.faabUsed[Number(r)] ?? 0, startedPoints: 0 }])
  );
  for (const m of insights.waivers) {
    const t = out.get(m.rosterId);
    if (!t) continue;
    t.moves++;
    t.startedPoints += m.startedPoints;
  }
  return [...out.values()];
}

/** Best pickups by points started afterwards */
export const bestPickups = (insights: SeasonInsights, n = 10): WaiverMove[] =>
  [...insights.waivers].sort((a, b) => b.startedPoints - a.startedPoints).slice(0, n);

/** Biggest bids for the least: points started per FAAB dollar, among bids of $10 or more */
export const worstBids = (insights: SeasonInsights, n = 5): WaiverMove[] =>
  insights.waivers
    .filter((m) => (m.bid ?? 0) >= 10)
    .sort((a, b) => a.startedPoints / (a.bid ?? 1) - b.startedPoints / (b.bid ?? 1))
    .slice(0, n);

/** Closest wins on contested claims: the smallest gap to the next bid */
export const closestBids = (insights: SeasonInsights, n = 5): Array<WaiverMove & { gap: number }> =>
  insights.waivers
    .filter((m) => m.bid !== null && m.losingBids.length > 0 && (m.bid ?? 0) > 0)
    .map((m) => ({ ...m, gap: (m.bid ?? 0) - m.losingBids[0].bid }))
    .sort((a, b) => a.gap - b.gap || (b.bid ?? 0) - (a.bid ?? 0))
    .slice(0, n);
