/**
 * What it takes to win a live matchup, from the same model as the Live tab's win odds
 * (lib/analyze/live.ts matchupModels), so every number here agrees with the odds shown:
 * - the points a side's players still to play need to add to be favored, and the range that
 *   target moves over with the other side's players;
 * - the side's odds if its players have a bad, typical or great rest of the week;
 * - which players still to play swing the matchup most (a good game against a bad one);
 * - lineup swaps still open (players whose games haven't started) and the odds with each.
 */

import type { SleeperMatchup } from '../types';
import {
  modelOdds,
  playerRemainingQuantile,
  remainingDistribution,
  remainingPointsOdds,
  sideModel,
  RP_STEP,
  isRuledOut,
  type DefenseContext,
  type LiveGame,
  type LiveProjection,
  type MatchupModel,
  type PlayerTerm,
  type SideModel,
} from './live';
import { normalCdf } from './trade';

export type SideKey = 'a' | 'b';

/** A bad, typical and great rest of the week: the percentiles the panel shows */
export const BAD = 0.25;
export const GREAT = 0.75;
const Z_GREAT = 0.6745;

const other = (side: SideKey): SideKey => (side === 'a' ? 'b' : 'a');

/** Starters still to play on this side */
export const playersLeft = (s: SideModel) => s.s.toPlay + s.s.playing;

/** Points this side's players are still expected to add */
export const expectedLeft = (s: SideModel) => s.s.projected - s.s.score;

/**
 * This side's chance of winning if its players still to play add exactly x points: the other
 * side's normal curve, blended into its real distribution as the model blends them (weight)
 */
export function oddsIfAdds(model: MatchupModel, side: SideKey, x: number): number {
  const me = model[side];
  const them = model[other(side)];
  const margin = me.s.score + x - them.s.projected;
  const sd = Math.sqrt(them.variance);
  const normal = sd > 0.01 ? normalCdf(margin / sd) : margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  // With the other side's players still to play, never certain (as the odds shown)
  const undecided = (p: number) => (playersLeft(them) > 0 ? Math.min(1 - 1e-6, Math.max(1e-6, p)) : p);
  if (model.weight <= 0) return undecided(normal);
  // The other side's players carry their own signs (+1 for a's, -1 for b's): count them against this side
  const lead = me.s.score + x - them.s.score;
  const sim = side === 'a'
    ? remainingPointsOdds(lead, them.players, them.defenses)
    : 1 - remainingPointsOdds(-lead, them.players, them.defenses);
  return undecided(model.weight * sim + (1 - model.weight) * normal);
}

/** The x where an increasing function of x crosses a level (bisection) */
function solve(f: (x: number) => number, level: number, lo: number, hi: number): number {
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < level) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** How far the margin could plausibly still move: bounds for the searches */
const searchRange = (model: MatchupModel) => {
  const sd = Math.sqrt(model.a.variance + model.b.variance);
  const span = Math.abs(model.a.s.score - model.b.s.score) + expectedLeft(model.a) + expectedLeft(model.b) + 8 * sd + 50;
  return [-span, span] as const;
};

export interface Target {
  /** Points the side's players still to play need to add to be favored (50%) */
  favored: number;
  /** The same for a 25% and a 75% chance: how much the other side's players move the target */
  low: number;
  high: number;
  /** The other side is done: the exact points needed to win (ties aside) */
  exact: boolean;
}

/** What this side's players still to play need to add (null when it has none left) */
export function target(model: MatchupModel, side: SideKey): Target | null {
  if (playersLeft(model[side]) === 0) return null;
  const [lo, hi] = searchRange(model);
  const f = (x: number) => oddsIfAdds(model, side, x);
  const them = model[other(side)];
  const exact = playersLeft(them) === 0;
  if (exact) {
    const need = them.s.score - model[side].s.score;
    return { favored: need, low: need, high: need, exact };
  }
  return { favored: solve(f, 0.5, lo, hi), low: solve(f, BAD, lo, hi), high: solve(f, GREAT, lo, hi), exact };
}

/**
 * The points this side's players still to play add at this percentile: the model's normal curve,
 * blended with their real distributions as the odds are
 */
export function sideQuantile(model: MatchupModel, side: SideKey, prob: number): number {
  const s = model[side];
  const mu = expectedLeft(s);
  const sd = Math.sqrt(s.variance);
  const sign = side === 'a' ? 1 : -1;
  const dist = model.weight > 0 ? [...remainingDistribution(s.players, s.defenses)].map(([k, p]) => [sign * k * RP_STEP, p] as const) : [];
  const cdf = (x: number) => {
    const normal = sd > 0.01 ? normalCdf((x - mu) / sd) : x >= mu ? 1 : 0;
    if (!dist.length) return normal;
    const sim = dist.reduce((t, [v, p]) => t + (v <= x ? p : 0), 0);
    return model.weight * sim + (1 - model.weight) * normal;
  };
  const [lo, hi] = searchRange(model);
  return solve(cdf, prob, lo, hi);
}

export interface Outcome {
  label: string;
  /** Points its players add */
  adds: number;
  /** This side's chance of winning with them */
  odds: number;
}

/** This side's odds if its players have a bad, typical or great rest of the week */
export function outcomes(model: MatchupModel, side: SideKey): Outcome[] {
  if (playersLeft(model[side]) === 0) return [];
  return [
    ['Bad day', BAD],
    ['Typical', 0.5],
    ['Great day', GREAT],
  ].map(([label, p]) => {
    const adds = sideQuantile(model, side, p as number);
    return { label: label as string, adds, odds: oddsIfAdds(model, side, adds) };
  });
}

/** a's odds with one player's points still to come fixed at a value */
function oddsWithPlayerAt(model: MatchupModel, side: SideKey, term: PlayerTerm, value: number): number {
  const shift = (s: SideModel, own: boolean): SideModel =>
    own
      ? {
          ...s,
          s: { ...s.s, score: s.s.score + value, projected: s.s.projected + value - term.add },
          variance: Math.max(0, s.variance - term.variance),
          players: s.players.filter((p) => p !== term.player),
          defenses: s.defenses.filter((d) => d !== term.defense),
        }
      : s;
  return modelOdds(shift(model.a, side === 'a'), shift(model.b, side === 'b')).aWinOdds;
}

export interface PlayerSwing {
  id: string;
  side: SideKey;
  /** Points he's still expected to add, and a bad and good rest of the game */
  expected: number;
  low: number;
  high: number;
  /** a's odds if he has a good game minus a bad one (negative for b's players) */
  aSwing: number;
}

/** A player's points still to come at a percentile: the tables for players, the model's normal for defenses */
export function playerQuantile(term: PlayerTerm, prob: number): number {
  const fromTable = term.player ? playerRemainingQuantile(term.player, prob) : null;
  if (fromTable !== null) return fromTable;
  const z = prob === 0.5 ? 0 : prob > 0.5 ? Z_GREAT : -Z_GREAT;
  return term.add + z * Math.sqrt(term.variance);
}

/** Every player still to play on both sides, the ones who swing the matchup most first */
export function playerSwings(model: MatchupModel): PlayerSwing[] {
  const out: PlayerSwing[] = [];
  for (const side of ['a', 'b'] as const) {
    for (const term of model[side].terms) {
      const low = playerQuantile(term, BAD);
      const high = playerQuantile(term, GREAT);
      out.push({ id: term.id, side, expected: term.add, low, high, aSwing: oddsWithPlayerAt(model, side, term, high) - oddsWithPlayerAt(model, side, term, low) });
    }
  }
  return out.sort((x, y) => Math.abs(y.aSwing) - Math.abs(x.aSwing));
}

/** Positions each lineup slot takes */
export const SLOT_POSITIONS: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['WR', 'RB'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

export interface Swap {
  /** Lineup slot (index into the starters) and who's in it now ('0' for an empty slot) */
  slot: number;
  out: string;
  in: string;
  /** This side's odds now and with the swap */
  before: number;
  after: number;
}

/**
 * Lineup swaps still open on this side: a bench player whose game hasn't started into a slot
 * whose player's hasn't either (or is empty), with this side's odds after each, best first.
 * Only swaps that gain at least minGain.
 */
export function swaps(
  model: MatchupModel,
  side: SideKey,
  matchups: SleeperMatchup[],
  projections: Record<string, LiveProjection>,
  games: Record<string, LiveGame>,
  slots: string[],
  defense: DefenseContext = {},
  minGain = 0.01
): Swap[] {
  const m = matchups.find((x) => x.roster_id === model[side].s.rosterId);
  if (!m) return [];
  const sign = side === 'a' ? 1 : -1;
  const before = side === 'a' ? model.aWinOdds : 1 - model.aWinOdds;
  const starters = m.starters ?? [];
  const notStarted = (id: string) => {
    const p = projections[id];
    const g = p?.team ? games[p.team] : undefined;
    return !g || g.state === 'pre';
  };
  const bench = (m.players ?? []).filter((id) => {
    const p = projections[id];
    const g = p?.team ? games[p.team] : undefined;
    return !starters.includes(id) && p && g?.state === 'pre' && p.points > 0 && !isRuledOut(p.injury);
  });
  const out: Swap[] = [];
  slots.forEach((slot, i) => {
    const current = starters[i] ?? '0';
    if (current !== '0' && !notStarted(current)) return;
    for (const id of bench) {
      if (!(SLOT_POSITIONS[slot] ?? []).includes(projections[id].position)) continue;
      const lineup = [...starters];
      lineup[i] = id;
      const s = sideModel({ ...m, starters: lineup }, sign, projections, games, model.scale, defense);
      const a = side === 'a' ? s : model.a;
      const b = side === 'b' ? s : model.b;
      const odds = modelOdds(a, b).aWinOdds;
      const after = side === 'a' ? odds : 1 - odds;
      if (after - before >= minGain) out.push({ slot: i, out: current, in: id, before, after });
    }
  });
  return out.sort((x, y) => y.after - x.after);
}

/**
 * The one line for a matchup card: what the side with work to do needs. When one side is done,
 * the other's exact need; otherwise what the underdog needs to be favored. Null before anyone has
 * played, after everyone has, or when the side still playing already leads a finished opponent.
 */
export function needLine(model: MatchupModel): { side: SideKey; need: number; players: number; expected: number; exact: boolean } | null {
  const { a, b } = model;
  const started = a.s.score !== 0 || b.s.score !== 0 || a.s.playing + b.s.playing > 0;
  if (!started) return null;
  const leftA = playersLeft(a);
  const leftB = playersLeft(b);
  if (leftA === 0 && leftB === 0) return null;
  const side: SideKey = leftB === 0 ? 'a' : leftA === 0 ? 'b' : model.aWinOdds < 0.5 ? 'a' : 'b';
  const t = target(model, side);
  if (!t || (t.exact && t.favored < 0)) return null;
  return { side, need: Math.max(0, t.favored), players: playersLeft(model[side]), expected: expectedLeft(model[side]), exact: t.exact };
}

/**
 * Receivers' points still to come move with the score: a WR whose team is up 17+ in the 3rd
 * quarter scored 0.57 of his remaining projection in 2018-2025, one down 9-16 1.32 (live_state.py).
 * Adding that to the model narrowly failed its test (PREREGISTRATION_2026.md, test 8), so it
 * stays a note: for a WR or TE in the second half of a game decided by 17+.
 */
export function gameScriptNote(position: string, game: LiveGame | null | undefined): string | null {
  if (!game || game.state !== 'in' || game.remaining > 0.5 || game.score === undefined) return null;
  if (position !== 'WR' && position !== 'TE') return null;
  const margin = game.score - (game.opponentScore ?? 0);
  if (Math.abs(margin) < 17) return null;
  return margin > 0
    ? `Up ${margin}: receivers on a team this far ahead usually score less than projected`
    : `Down ${-margin}: receivers on a team this far behind usually score more than projected`;
}
