import { describe, expect, it } from 'vitest';
import { lineupAdvice } from '../analyze/lineupAssistant';
import type { TradeInputs } from '../analyze/trade';

// QB, RB, WR and two bench spots; week 7 projections
const base = (over: Partial<TradeInputs> = {}): TradeInputs => ({
  weeks: [7, 8],
  projections: { qb1: { 7: 20, 8: 20 }, qb2: { 7: 12, 8: 12 }, rb1: { 7: 0, 8: 15 }, rb2: { 7: 9, 8: 9 }, wr1: { 7: 14, 8: 14 }, wr2: { 7: 5, 8: 5 }, rk: { 7: 16, 8: 16 } },
  positions: { qb1: 'QB', qb2: 'QB', rb1: 'RB', rb2: 'RB', wr1: 'WR', wr2: 'WR', rk: 'WR' },
  rosters: { 1: ['qb1', 'qb2', 'rb1', 'rb2', 'wr1', 'wr2'] },
  freeAgents: [],
  rosterPositions: ['QB', 'RB', 'WR', 'BN', 'BN', 'BN'],
  lastScoredWeek: 6,
  ...over,
});

describe('lineupAdvice', () => {
  it('finds the swaps from the set lineup to the best one, and starters projected for nothing', () => {
    // rb1 is on bye in week 7 (0) but set to start; rb2 (9) should
    const advice = lineupAdvice(base(), 1, ['qb1', 'rb1', 'wr1'], 7);
    expect(advice.setTotal).toBe(34);
    expect(advice.bestTotal).toBe(43);
    expect(advice.swaps).toEqual([{ start: 'rb2', sit: 'rb1', gain: 9 }]);
    expect(advice.zeros).toEqual(['rb1']);
  });

  it('never starts a player in an IR slot', () => {
    expect(lineupAdvice(base({ reserve: { 1: ['rb2'] } }), 1, ['qb1', 'rb1', 'wr1'], 7).swaps).toEqual([]);
  });

  it('reports nothing to change when the best lineup is set, and counts empty slots', () => {
    expect(lineupAdvice(base(), 1, ['qb1', 'rb2', 'wr1'], 7).swaps).toEqual([]);
    const empty = lineupAdvice(base(), 1, ['qb1', '0', 'wr1'], 7);
    expect(empty.emptySlots).toBe(1);
    expect(empty.swaps).toEqual([{ start: 'rb2', sit: null, gain: 9 }]);
  });
});
