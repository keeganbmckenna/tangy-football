/**
 * The lineup assistant: the lineup you've set in Sleeper against the best one by projections, with the
 * trade tools' weekly projections and lineup solver (lib/analyze/trade.ts). Ported from ffbrains, without
 * its dynasty taxi squad half.
 */

import { bestLineup, SLOT_POSITIONS } from './playoffOdds';
import type { TradeInputs } from './trade';

const NON_STARTING = new Set(['BN', 'IR', 'TAXI']);

export interface LineupSwap {
  /** Start this player (null: nobody better, leave the slot as is) */
  start: string;
  /** In place of this one (null: an empty slot) */
  sit: string | null;
  gain: number;
}

export interface LineupAdvice {
  week: number;
  /** Projected points of the lineup set in Sleeper, and of the best one */
  setTotal: number;
  bestTotal: number;
  swaps: LineupSwap[];
  /** Starters projected for nothing (out, on bye or not playing) and empty starting slots */
  zeros: string[];
  emptySlots: number;
}

const weekPoints = (inputs: TradeInputs, week: number, p: string) => inputs.projections[p]?.[week] ?? 0;

/**
 * The lineup set for `week` against the best one. setStarters: Sleeper's starters in slot order ('0' or
 * '' for an empty slot). Swaps pair the players coming in (best first) with a slot each can fill.
 */
export function lineupAdvice(inputs: TradeInputs, rosterId: number, setStarters: string[], week: number): LineupAdvice {
  const roster = inputs.rosters[rosterId] ?? [];
  // Players in IR slots can't start
  const usable = roster.filter((p) => !(inputs.reserve?.[rosterId] ?? []).includes(p));
  const proj = Object.fromEntries(
    usable.filter((p) => inputs.positions[p]).map((p) => [p, { position: inputs.positions[p], points: weekPoints(inputs, week, p) }])
  );
  const best = bestLineup(usable, proj, inputs.rosterPositions);
  const starting = inputs.rosterPositions.filter((s) => !NON_STARTING.has(s)).length;
  const slots = inputs.rosterPositions.filter((s) => !NON_STARTING.has(s));
  const set = setStarters.slice(0, starting);
  const fits = (p: string, slot: string) => (SLOT_POSITIONS[slot] ?? [slot]).includes(inputs.positions[p]);
  const setIds = set.filter((p) => p && p !== '0');
  const setTotal = setIds.reduce((s, p) => s + weekPoints(inputs, week, p), 0);
  const bestIds = new Set(best.starters.map((s) => s.playerId));
  const incoming = best.starters.map((s) => s.playerId).filter((p) => !setIds.includes(p)).sort((a, b) => weekPoints(inputs, week, b) - weekPoints(inputs, week, a));
  const emptySlots = Math.max(0, starting - setIds.length);
  // Pair each player coming in with the worst one going out whose slot he can fill (an empty slot
  // first), so every swap can be made as shown; the gains still add up to the best lineup's
  const openSlots = slots.map((slot, i) => ({ slot, player: set[i] && set[i] !== '0' ? set[i] : null })).filter((s) => !s.player || !bestIds.has(s.player));
  const swaps = incoming.map((start) => {
    const candidates = openSlots.filter((s) => fits(start, s.slot));
    const pool = candidates.length ? candidates : openSlots;
    const chosen = pool.find((s) => !s.player) ?? pool.sort((a, b) => weekPoints(inputs, week, a.player!) - weekPoints(inputs, week, b.player!))[0];
    if (chosen) openSlots.splice(openSlots.indexOf(chosen), 1);
    const sit = chosen?.player ?? null;
    return { start, sit, gain: weekPoints(inputs, week, start) - (sit ? weekPoints(inputs, week, sit) : 0) };
  });
  return {
    week,
    setTotal,
    bestTotal: best.total,
    swaps: swaps.filter((s) => s.gain > 0.05).sort((a, b) => b.gain - a.gain),
    zeros: setIds.filter((p) => weekPoints(inputs, week, p) <= 0),
    emptySlots,
  };
}
