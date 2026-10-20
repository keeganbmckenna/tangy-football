import { describe, it, expect } from 'vitest';
import { bestLineupPoints, teamStrength } from '../analyze/playoffOdds';
import type { TradeDataResponse } from '../analyze/trade';
import { findTrades, marketFair, packageValue } from '../analyze/tradeFinder';

// Lineup: QB, RB, WR and two bench spots. Team 1 has two good QBs and a weak RB;
// team 2 has two good RBs and a weak QB, so a QB-for-RB swap helps both.
const ROSTER_POSITIONS = ['QB', 'RB', 'WR', 'BN', 'BN'];
const PLAYERS: Record<string, [string, number, number | null]> = {
  // id: position, expected points per week, market value
  qbA: ['QB', 20, 6000], qbB: ['QB', 18, 4000], rbA: ['RB', 6, 300], wrA: ['WR', 12, 3000], wrB: ['WR', 5, 200],
  qbC: ['QB', 8, 500], rbC: ['RB', 16, 5000], rbD: ['RB', 15, 4200], wrC: ['WR', 12, 3000], wrD: ['WR', 5, 200],
  qbE: ['QB', 14, 2500], rbE: ['RB', 12, 2500], wrE: ['WR', 12, 3000], wrF: ['WR', 6, 300], rbF: ['RB', 5, 200],
  qbG: ['QB', 14, 2500], rbG: ['RB', 12, 2500], wrG: ['WR', 12, 3000], wrH: ['WR', 6, 300], rbH: ['RB', 5, 200],
};
const ROSTERS: Record<number, string[]> = {
  1: ['qbA', 'qbB', 'rbA', 'wrA', 'wrB'],
  2: ['qbC', 'rbC', 'rbD', 'wrC', 'wrD'],
  3: ['qbE', 'rbE', 'wrE', 'wrF', 'rbF'],
  4: ['qbG', 'rbG', 'wrG', 'wrH', 'rbH'],
};
const WEEKS = [7, 8, 9, 10];

function league(values: Partial<Record<string, number | null>> = {}): TradeDataResponse {
  const projections = Object.fromEntries(Object.entries(PLAYERS).map(([id, [, pts]]) => [id, Object.fromEntries(WEEKS.map((w) => [w, pts]))]));
  const positions = Object.fromEntries(Object.entries(PLAYERS).map(([id, [pos]]) => [id, pos]));
  const week = Object.fromEntries(Object.entries(PLAYERS).map(([id, [pos, pts]]) => [id, { position: pos, points: pts }]));
  const lineups = Object.fromEntries(WEEKS.map((w) => [w, Object.fromEntries(Object.entries(ROSTERS).map(([r, ps]) => [r, bestLineupPoints(ps, week, ROSTER_POSITIONS, {})]))]));
  const scores = { 1: [100, 100], 2: [100, 100], 3: [100, 100], 4: [100, 100] };
  const { meanByWeek } = teamStrength(scores, WEEKS, lineups);
  const teams = [1, 2, 3, 4].map((id) => ({ rosterId: id, teamName: '', username: '', division: 0, wins: 1, losses: 1, ties: 0, pointsFor: 200 }));
  return {
    open: true,
    season: '2026',
    currentWeek: 7,
    tradeDeadline: 11,
    regularSeasonEnd: 8,
    playoffWeekStart: 9,
    format: { playoffTeams: 2, hasDivisions: false, byes: 0 },
    hasToiletBowl: false,
    teams,
    remaining: [
      { week: 7, a: 1, b: 3 }, { week: 7, a: 2, b: 4 },
      { week: 8, a: 1, b: 4 }, { week: 8, a: 2, b: 3 },
    ],
    meanByWeek,
    spread: 20,
    inputs: { weeks: WEEKS, projections, positions, rosters: ROSTERS, freeAgents: [], streams: {}, rosterPositions: ROSTER_POSITIONS, lastScoredWeek: 6 },
    players: Object.fromEntries(Object.entries(PLAYERS).map(([id, [pos, pts, value]]) => [
      id,
      { id, name: id, position: pos, team: null, injury: null, expectedPerWeek: pts, seasonPerGame: null, value: id in values ? values[id]! : value, byeWeek: null },
    ])),
    marketValues: true,
    generatedAt: '',
  };
}

describe('market values', () => {
  it('favor the best player in a package', () => {
    // Two 3,000s add up to more than one 5,000 but are worth less as a package
    expect(packageValue([3000, 3000])).toBeLessThan(5000);
    expect(packageValue([5000])).toBeCloseTo(5000);
  });

  it('call a trade fair when the partner gets back at least 85% of what it gives', () => {
    expect(marketFair([4000], [3500])).toBe(true);
    expect(marketFair([4000], [3000])).toBe(false);
    expect(marketFair([0], [100])).toBeNull();
  });
});

describe('findTrades', () => {
  it('finds the swap of surplus for need that helps both teams', () => {
    const results = findTrades(league(), 1, { marketFilter: true, sims: 2000, finalSims: 2000 });
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    expect(top.partner).toBe(2);
    expect(top.gives).toContain('qbB');
    expect(top.gets.some((p) => p === 'rbC' || p === 'rbD')).toBe(true);
    // Both teams' lineups improve, and the partner's odds don't drop
    expect(top.lineup.me[1]).toBeGreaterThan(top.lineup.me[0]);
    expect(top.lineup.partner[1]).toBeGreaterThanOrEqual(top.lineup.partner[0]);
    expect(top.odds.me[1].playoffs).toBeGreaterThan(top.odds.me[0].playoffs);
    expect(top.odds.partner[1].playoffs).toBeGreaterThanOrEqual(top.odds.partner[0].playoffs - 0.005);
  });

  it('never returns a trade that hurts the partner', () => {
    for (const r of findTrades(league(), 1, { marketFilter: false, sims: 2000, finalSims: 2000 })) {
      expect(r.odds.partner[1].playoffs).toBeGreaterThanOrEqual(r.odds.partner[0].playoffs - 0.005);
      expect(r.lineup.partner[1] - r.lineup.partner[0]).toBeGreaterThanOrEqual(-0.5);
    }
  });

  it('hides trades the market sees as lopsided against the partner, unless the filter is off', () => {
    // Make team 2's RBs far pricier than team 1's spare QB
    const pricey = league({ rbC: 9000, rbD: 9000 });
    const filtered = findTrades(pricey, 1, { marketFilter: true, sims: 2000, finalSims: 2000 });
    expect(filtered.every((r) => r.market.fair !== false)).toBe(true);
    expect(filtered.some((r) => r.gets.includes('rbC') || r.gets.includes('rbD'))).toBe(false);
    const all = findTrades(pricey, 1, { marketFilter: false, sims: 2000, finalSims: 2000 });
    expect(all.some((r) => r.gets.includes('rbC') || r.gets.includes('rbD'))).toBe(true);
  });

  it('only uses the allowed trade sizes', () => {
    const allowed = new Set(['1-for-1', '1-for-2', '2-for-1', '2-for-2', '3-for-1', '1-for-3', '3-for-2', '2-for-3']);
    for (const r of findTrades(league(), 1, { marketFilter: false, sims: 2000, finalSims: 2000, deep: true })) {
      expect(allowed.has(r.size)).toBe(true);
    }
  });
});
