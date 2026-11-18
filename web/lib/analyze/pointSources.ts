/**
 * Where a team's points came from (Season in Review): every regular-season start credited to how
 * the team got the player, by the latest way he joined that roster at or before that week:
 *
 * - drafted (week 0, the season's draft);
 * - picked up (a waiver claim or free-agent add, from its week);
 * - traded for (from the first week the trade counted);
 * - other (none of these: a commissioner's move).
 *
 * Each source against the league's average team, and the points above average in wins: the
 * season's league-wide slope of expected wins (all-play) on points.
 */

import type { SeasonInsights } from './insights';
import type { DraftPickData } from './draft';
import type { TradeHistoryEntry } from './trade';

export type PointSource = 'drafted' | 'pickups' | 'trades' | 'other';
export const POINT_SOURCES: PointSource[] = ['drafted', 'pickups', 'trades', 'other'];

export type SourcePoints = Record<PointSource, number>;

export interface TeamPointSources {
  rosterId: number;
  /** Starting-lineup points by how the starters were acquired */
  points: SourcePoints;
  /** All of them: the team's regular-season starting-lineup points */
  total: number;
}

const empty = (): SourcePoints => ({ drafted: 0, pickups: 0, trades: 0, other: 0 });

/** Ways each roster got each player, by week: [week, source] */
type Acquisitions = Map<string, Array<[number, PointSource]>>;

const key = (rosterId: number, playerId: string) => `${rosterId}:${playerId}`;

function acquisitions(insights: SeasonInsights, picks: DraftPickData[], trades: TradeHistoryEntry[]): Acquisitions {
  const out: Acquisitions = new Map();
  const add = (rosterId: number, playerId: string, week: number, source: PointSource) => {
    const k = key(rosterId, playerId);
    out.set(k, [...(out.get(k) ?? []), [week, source]]);
  };
  for (const p of picks) if (p.roster_id !== null && p.player_id) add(p.roster_id, p.player_id, 0, 'drafted');
  for (const m of insights.waivers) add(m.rosterId, m.playerId, m.week, 'pickups');
  for (const t of trades) for (const s of t.sides) for (const id of s.receives) add(s.rosterId, id, t.effectiveWeek ?? t.week, 'trades');
  // In week order; a trade the same week as a pickup counts as the later of the two
  const rank: Record<PointSource, number> = { drafted: 0, pickups: 1, trades: 2, other: 3 };
  for (const list of out.values()) list.sort((a, b) => a[0] - b[0] || rank[a[1]] - rank[b[1]]);
  return out;
}

/** How the roster got the player it started this week */
export function sourceOf(acq: Acquisitions, rosterId: number, playerId: string, week: number): PointSource {
  const list = acq.get(key(rosterId, playerId));
  let source: PointSource = 'other';
  for (const [w, s] of list ?? []) if (w <= week) source = s;
  return source;
}

/** Every team's regular-season starting-lineup points, by how its starters were acquired */
export function pointSources(insights: SeasonInsights, picks: DraftPickData[], trades: TradeHistoryEntry[]): TeamPointSources[] {
  const acq = acquisitions(insights, picks, trades);
  return Object.entries(insights.teams).map(([rid, weeks]) => {
    const rosterId = Number(rid);
    const points = empty();
    for (const tw of weeks) {
      if (tw.week > insights.regularSeasonEnd) continue;
      for (const id of tw.starters) points[sourceOf(acq, rosterId, id, tw.week)] += tw.playerPoints[id] ?? 0;
    }
    return { rosterId, points, total: POINT_SOURCES.reduce((s, k) => s + points[k], 0) };
  });
}

/** The league's average team: each source's points averaged over the teams */
export function averageTeam(teams: TeamPointSources[]): TeamPointSources {
  const points = empty();
  for (const t of teams) for (const k of POINT_SOURCES) points[k] += t.points[k] / teams.length;
  return { rosterId: 0, points, total: POINT_SOURCES.reduce((s, k) => s + points[k], 0) };
}

/** Least-squares slope of y on x: wins per point across the league's teams (0 if the points don't vary) */
export function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : 0;
}
