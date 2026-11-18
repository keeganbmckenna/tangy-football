/**
 * What a manager controlled, against what their own roster offered (manager pages' Decisions,
 * Season in Review): every regular-season week judged before kickoff by Sleeper's projections,
 * then what actually happened. Definitions match scripts/backtests/manager_causes.py, which
 * found on thousands of active leagues which of these carry over for the same manager (the
 * start/sit habits and proactive pickups) and which swing with luck (how overrides turn out,
 * trades).
 *
 * - A week is judged when every starter had a projection (insights' `unprojected`).
 * - Projections' lineup: the starters projected within 1 point of the roster's best lineup.
 * - Override: every starter projected to play, but the lineup projected 1+ point lower.
 * - Starting someone who couldn't play: a starter projected at 0 (on bye or out).
 * - Proactive add: without the players added that week, the roster could still fill its
 *   lineup with players projected to play; otherwise a fill.
 */

import type { SeasonInsights, TeamWeek } from './insights';
import { bestLineup } from './playoffOdds';
import { slope } from './pointSources';

/** A lineup projected this far below the best counts as an override */
export const OVERRIDE_POINTS = 1;

export interface Override {
  week: number;
  /** Projected points the lineup gave up against the projections' lineup */
  projectedCost: number;
  /** What it actually scored against the projections' lineup (+ means the override paid off) */
  actual: number;
  /** The real result, if the projections' lineup would have had the other one */
  flipped: 'won' | 'lost' | null;
  /** Started instead of the projections' picks, and the picks left on the bench */
  started: string[];
  benched: string[];
}

export interface NoShow {
  week: number;
  playerId: string;
}

export interface Pickup {
  week: number;
  playerId: string;
  proactive: boolean;
  /** Points he scored in this roster's lineup from then on */
  points: number;
}

export interface TeamSeasonDecisions {
  season: string;
  rosterId: number;
  /** Regular-season weeks that could be judged */
  weeks: number;
  /** Weeks it started the projections' lineup */
  projectionLineupWeeks: number;
  /** Projected points given up over the season, against the projections' lineup every week */
  projectedGivenUp: number;
  overrides: Override[];
  noShows: NoShow[];
  pickups: Pickup[];
  /** Wins per point this season (all-play expected wins on points across the league), to put points in wins */
  winsPerPoint: number;
  /** Weeks in this season's regular season, to scale a season in progress to a full one */
  seasonWeeks: number;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

function judge(tw: TeamWeek, insights: SeasonInsights, rosterPositions: string[]) {
  if (tw.projectedBestProjected == null || !tw.benchProjections) return null;
  const unprojected = new Set(tw.unprojected ?? []);
  if (tw.starters.some((id) => unprojected.has(id))) return null;
  const started = sum(tw.starters.map((id) => tw.starterProjections[id] ?? 0));
  const gap = Math.max(0, tw.projectedBestProjected - started);
  const noShows = tw.starters.filter((id) => (tw.starterProjections[id] ?? 0) <= 0);
  // The projections' lineup itself, for who was swapped
  const all = { ...tw.benchProjections, ...tw.starterProjections };
  const byProjection = Object.fromEntries(
    Object.entries(all)
      .filter(([id]) => insights.players[id])
      .map(([id, p]) => [id, { position: insights.players[id].position, points: p }])
  );
  const picks = new Set(bestLineup(Object.keys(byProjection), byProjection, rosterPositions).starters.map((s) => s.playerId));
  return { gap, noShows, picks };
}

/** Each team's season of decisions */
export function teamSeasonDecisions(insights: SeasonInsights): TeamSeasonDecisions[] {
  const rosterPositions = insights.rosterPositions ?? [];
  const regular = (weeks: TeamWeek[]) => weeks.filter((w) => w.week <= insights.regularSeasonEnd && w.points > 0);

  // Points into wins: each team's all-play expected wins against its points
  const scores = new Map<number, number[]>();
  for (const weeks of Object.values(insights.teams)) for (const w of regular(weeks)) scores.set(w.week, [...(scores.get(w.week) ?? []), w.points]);
  const totals: number[] = [];
  const expected: number[] = [];
  for (const weeks of Object.values(insights.teams)) {
    const ws = regular(weeks);
    if (!ws.length) continue;
    totals.push(sum(ws.map((w) => w.points)));
    expected.push(
      sum(ws.map((w) => {
        const others = (scores.get(w.week) ?? []).length - 1;
        if (others <= 0) return 0;
        const below = (scores.get(w.week) ?? []).filter((x) => x < w.points).length;
        const ties = (scores.get(w.week) ?? []).filter((x) => x === w.points).length - 1;
        return (below + ties / 2) / others;
      }))
    );
  }
  const winsPerPoint = slope(totals, expected);

  return Object.entries(insights.teams).map(([rid, weeks]) => {
    const rosterId = Number(rid);
    const byWeek = new Map(weeks.map((w) => [w.week, w]));
    const out: TeamSeasonDecisions = { season: insights.season, rosterId, weeks: 0, projectionLineupWeeks: 0, projectedGivenUp: 0, overrides: [], noShows: [], pickups: [], winsPerPoint, seasonWeeks: insights.regularSeasonEnd };
    for (const tw of regular(weeks)) {
      const j = rosterPositions.length ? judge(tw, insights, rosterPositions) : null;
      if (!j) continue;
      out.weeks++;
      out.projectedGivenUp += j.gap;
      if (j.noShows.length) {
        for (const playerId of j.noShows) out.noShows.push({ week: tw.week, playerId });
      } else if (j.gap >= OVERRIDE_POINTS) {
        const actual = tw.projectedBest != null ? tw.points - tw.projectedBest : 0;
        let flipped: Override['flipped'] = null;
        if (tw.opponentPoints != null && tw.projectedBest != null) {
          const real = tw.points > tw.opponentPoints;
          const alt = tw.projectedBest > tw.opponentPoints;
          if (real && !alt) flipped = 'won';
          else if (!real && alt) flipped = 'lost';
        }
        out.overrides.push({
          week: tw.week,
          projectedCost: j.gap,
          actual,
          flipped,
          started: tw.starters.filter((id) => !j.picks.has(id)),
          benched: [...j.picks].filter((id) => !tw.starters.includes(id)),
        });
      }
      if (j.gap < OVERRIDE_POINTS && !j.noShows.length) out.projectionLineupWeeks++;
    }
    // Pickups: proactive if, without that week's adds, the lineup could still be filled with players projected to play
    const moves = insights.waivers.filter((m) => m.rosterId === rosterId && m.week <= insights.regularSeasonEnd);
    for (const m of moves) {
      const tw = byWeek.get(m.week);
      let proactive = true;
      if (tw?.benchProjections && rosterPositions.length) {
        const added = new Set(moves.filter((o) => o.week === m.week).map((o) => o.playerId));
        const all = { ...tw.benchProjections, ...tw.starterProjections };
        const pool = Object.fromEntries(
          Object.entries(all)
            .filter(([id, p]) => !added.has(id) && p > 0 && insights.players[id])
            .map(([id, p]) => [id, { position: insights.players[id].position, points: p }])
        );
        const slots = rosterPositions.filter((s) => !['BN', 'IR', 'TAXI'].includes(s)).length;
        proactive = bestLineup(Object.keys(pool), pool, rosterPositions).starters.length >= slots;
      }
      out.pickups.push({ week: m.week, playerId: m.playerId, proactive, points: m.startedPoints });
    }
    return out;
  });
}

/** The numbers a panel shows, for one season or several added up */
export interface DecisionSummary {
  seasons: number;
  weeks: number;
  projectionLineupWeeks: number;
  /** Projected points given up a season (per week judged, over a full regular season), and in wins */
  givenUpPerSeason: number;
  givenUpWinsPerSeason: number;
  overrides: number;
  /** What the overrides actually did, in points and games */
  overrideNet: number;
  gamesWon: number;
  gamesLost: number;
  noShows: number;
  proactiveAdds: number;
  fills: number;
  proactivePerSeason: number;
  pickupPoints: number;
}

export function summarize(list: TeamSeasonDecisions[]): DecisionSummary {
  const seasons = list.length;
  // A full season's worth: per week judged, times a regular season's weeks (so a season in progress compares)
  const weeks = sum(list.map((d) => d.weeks));
  const seasonWeeks = seasons ? sum(list.map((d) => d.seasonWeeks)) / seasons : 0;
  const perSeason = (v: number) => (weeks ? (v / weeks) * seasonWeeks : 0);
  const pickups = list.flatMap((d) => d.pickups);
  const overrides = list.flatMap((d) => d.overrides);
  return {
    seasons,
    weeks,
    projectionLineupWeeks: sum(list.map((d) => d.projectionLineupWeeks)),
    givenUpPerSeason: perSeason(sum(list.map((d) => d.projectedGivenUp))),
    givenUpWinsPerSeason: perSeason(sum(list.map((d) => d.projectedGivenUp * d.winsPerPoint))),
    overrides: overrides.length,
    overrideNet: sum(overrides.map((o) => o.actual)),
    gamesWon: overrides.filter((o) => o.flipped === 'won').length,
    gamesLost: overrides.filter((o) => o.flipped === 'lost').length,
    noShows: sum(list.map((d) => d.noShows.length)),
    proactiveAdds: pickups.filter((p) => p.proactive).length,
    fills: pickups.filter((p) => !p.proactive).length,
    proactivePerSeason: perSeason(pickups.filter((p) => p.proactive).length),
    pickupPoints: sum(pickups.map((p) => p.points)),
  };
}

/** The middle half of the league's team-seasons for a number (25th to 75th percentile) */
export function middleHalf(values: number[]): [number, number] | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 4) return null;
  const at = (q: number) => {
    const i = (v.length - 1) * q;
    const lo = Math.floor(i);
    return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo);
  };
  return [at(0.25), at(0.75)];
}

/** Where a number sits against the league's middle half */
export function against(value: number, band: [number, number] | null): 'below' | 'typical' | 'above' | null {
  if (!band) return null;
  return value < band[0] ? 'below' : value > band[1] ? 'above' : 'typical';
}
