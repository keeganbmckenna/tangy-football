import { describe, it, expect } from 'vitest';
import {
  meansAfterTrade,
  normalCdf,
  parseTrades,
  rosterAfterTrade,
  starterPoints,
  tradeEffectWeight,
  tradeSeasonOdds,
  weeklyOutlook,
  weeklyWinProbability,
  type TradeInputs,
} from '../analyze/trade';
import type { SleeperMatchup, SleeperTransaction } from '../types';

// Lineup: QB, RB, WR, FLEX + 2 bench spots
const ROSTER_POSITIONS = ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN'];

function inputs(overrides: Partial<TradeInputs> = {}): TradeInputs {
  const flat = (pts: number) => ({ 7: pts, 8: pts });
  return {
    weeks: [7, 8],
    projections: {
      qb1: flat(20), rb1: flat(15), wr1: flat(14), rb2: flat(10), wr2: flat(8), wr3: flat(3),
      qb2: flat(18), rb3: flat(12), wr4: flat(16), wr5: flat(9), rb4: flat(5), te1: flat(7),
      fa_wr: flat(11), fa_qb: flat(19), fa_rb: flat(4),
    },
    positions: {
      qb1: 'QB', rb1: 'RB', wr1: 'WR', rb2: 'RB', wr2: 'WR', wr3: 'WR',
      qb2: 'QB', rb3: 'RB', wr4: 'WR', wr5: 'WR', rb4: 'RB', te1: 'TE',
      fa_wr: 'WR', fa_qb: 'QB', fa_rb: 'RB',
    },
    rosters: {
      1: ['qb1', 'rb1', 'wr1', 'rb2', 'wr2', 'wr3'],
      2: ['qb2', 'rb3', 'wr4', 'wr5', 'rb4', 'te1'],
    },
    freeAgents: ['fa_wr', 'fa_qb', 'fa_rb'],
    rosterPositions: ROSTER_POSITIONS,
    lastScoredWeek: 6,
    ...overrides,
  };
}

describe('rosterAfterTrade', () => {
  it('swaps players one for one with no other moves', () => {
    const change = rosterAfterTrade(inputs(), { rosterId: 1, sends: ['wr2'], receives: ['wr5'] });
    expect(change.after.sort()).toEqual(['qb1', 'rb1', 'rb2', 'wr1', 'wr3', 'wr5']);
    expect(change.dropped).toEqual([]);
    expect(change.added).toEqual([]);
  });

  it('drops the least useful player when receiving more than it sends', () => {
    // 2-for-1 into a full roster: three bench players would cost nothing, so the lowest-projected one goes
    const change = rosterAfterTrade(inputs(), { rosterId: 1, sends: ['wr2'], receives: ['wr4', 'wr5'] });
    expect(change.after).toHaveLength(6);
    expect(change.dropped).toEqual(['wr3']);
  });

  it("doesn't count players in IR slots toward the roster size", () => {
    // Team 1 has 7 players but wr3 is on IR: 6 active, so a 2-for-1 still forces one drop,
    // and wr3 (who can't be dropped to make room for active players) stays
    const inp = inputs({
      rosters: { ...inputs().rosters, 1: ['qb1', 'rb1', 'wr1', 'rb2', 'wr2', 'rb4', 'wr3'] },
      reserve: { 1: ['wr3'] },
    });
    const change = rosterAfterTrade(inp, { rosterId: 1, sends: ['wr2'], receives: ['wr4', 'wr5'] });
    expect(change.dropped).toHaveLength(1);
    expect(change.after).toContain('wr3');
    // Sending two for one opens a spot even though the roster lists 7 players
    const open = rosterAfterTrade(inp, { rosterId: 1, sends: ['wr1', 'rb2'], receives: ['wr5'] });
    expect(open.added).toEqual(['fa_wr']);
  });

  it('picks up the free agent that helps the lineup most when sending more than it receives', () => {
    // Team 1 sends both WRs it starts and gets one back: the best FA WR fills the hole,
    // not the higher-projected FA QB who would sit on the bench
    const change = rosterAfterTrade(inputs(), { rosterId: 1, sends: ['wr1', 'rb2'], receives: ['wr5'] });
    expect(change.added).toEqual(['fa_wr']);
    expect(change.after).toHaveLength(6);
  });
});

describe('trade effect', () => {
  it('fades with how far ahead the week is', () => {
    expect(tradeEffectWeight(1)).toBe(0.7);
    expect(tradeEffectWeight(2)).toBe(0.45);
    expect(tradeEffectWeight(3)).toBe(0.45);
    expect(tradeEffectWeight(9)).toBe(0.25);
  });

  it("moves each team's expected score by that share of its lineup change", () => {
    const inp = inputs();
    const before = { 7: { 1: 100, 2: 100 }, 8: { 1: 100, 2: 100 } };
    const changes = [
      rosterAfterTrade(inp, { rosterId: 1, sends: ['wr2'], receives: ['wr4'] }),
      rosterAfterTrade(inp, { rosterId: 2, sends: ['wr4'], receives: ['wr2'] }),
    ];
    const { meanByWeek, lineupDelta } = meansAfterTrade(before, inp, changes);
    // Team 1: wr4 (16) starts at WR and wr1 (14) moves to FLEX over rb2 (10): 59 -> 65
    expect(lineupDelta[1][7]).toBe(6);
    expect(meanByWeek[7][1]).toBeCloseTo(100 + 0.7 * 6);
    expect(meanByWeek[8][1]).toBeCloseTo(100 + 0.45 * 6);
    // Team 2 loses its best WR: wr5 (9) moves up, rb4 (5) leaves the FLEX for wr2 (8)
    expect(lineupDelta[2][7]).toBe(-8);
    // The input isn't changed
    expect(before[7][1]).toBe(100);
  });

  it('leaves everything unchanged for an empty trade', () => {
    const inp = inputs();
    const before = { 7: { 1: 100, 2: 95 }, 8: { 1: 100, 2: 95 } };
    const { meanByWeek } = meansAfterTrade(before, inp, [rosterAfterTrade(inp, { rosterId: 1, sends: [], receives: [] })]);
    expect(meanByWeek).toEqual(before);
  });
});

describe('weekly win odds', () => {
  it('uses a standard normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });

  it('is 50% for equal teams and less confident further ahead', () => {
    expect(weeklyWinProbability(100, 100, 25, 1)).toBeCloseTo(0.5);
    const next = weeklyWinProbability(110, 100, 25, 1);
    const later = weeklyWinProbability(110, 100, 25, 4);
    expect(next).toBeGreaterThan(later);
    expect(later).toBeGreaterThan(0.5);
  });

  it("lists a team's remaining games with its opponent", () => {
    const remaining = [
      { week: 8, a: 2, b: 1 },
      { week: 7, a: 1, b: 3 },
      { week: 7, a: 2, b: 4 },
    ];
    const means = { 7: { 1: 110, 2: 100, 3: 100, 4: 100 }, 8: { 1: 100, 2: 100, 3: 100, 4: 100 } };
    const outlook = weeklyOutlook(1, remaining, means, 25, 6);
    expect(outlook.map((o) => [o.week, o.opponent])).toEqual([[7, 3], [8, 2]]);
    expect(outlook[0].winProbability).toBeGreaterThan(0.5);
    expect(outlook[1].winProbability).toBeCloseTo(0.5);
  });
});

describe('tradeSeasonOdds', () => {
  const teams = Array.from({ length: 12 }, (_, i) => ({
    rosterId: i + 1, teamName: '', username: '', division: (i % 3) + 1, wins: 3, losses: 3, ties: 0, pointsFor: 600 + i,
  }));
  const remaining = [7, 8, 9].flatMap((w) => Array.from({ length: 6 }, (_, i) => ({ week: w, a: i * 2 + 1, b: i * 2 + 2 })));
  const means = (bump: number) =>
    Object.fromEntries([7, 8, 9, 15, 16, 17].map((w) => [w, Object.fromEntries(teams.map((t) => [t.rosterId, 100 + (t.rosterId === 5 ? bump : 0)]))]));
  const format = { playoffTeams: 6, hasDivisions: true, byes: 2 };

  it('gives identical odds for an unchanged team (same random draws)', () => {
    const { before, after } = tradeSeasonOdds(teams, remaining, format, means(0), means(0), 25, 15, true, 2000);
    expect(after.teams[5]).toEqual(before.teams[5]);
  });

  it('raises the odds of a team that gets stronger', () => {
    const { before, after } = tradeSeasonOdds(teams, remaining, format, means(0), means(8), 25, 15, true, 2000);
    expect(after.teams[5].playoffs).toBeGreaterThan(before.teams[5].playoffs);
    expect(after.teams[5].champion!).toBeGreaterThan(before.teams[5].champion!);
    expect(after.teams[5].lastPlace!).toBeLessThan(before.teams[5].lastPlace!);
  });
});

describe('past trades', () => {
  const tx = (overrides: Partial<SleeperTransaction>): SleeperTransaction => ({
    type: 'trade',
    transaction_id: 't1',
    status: 'complete',
    leg: 3,
    settings: null,
    roster_ids: [1, 2],
    adds: { p1: 2, p2: 1 },
    drops: { p1: 1, p2: 2 },
    draft_picks: [{ season: '2027', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 2 }],
    waiver_budget: [{ sender: 2, receiver: 1, amount: 10 }],
    created: 100,
    status_updated: 100,
    creator: 'u1',
    consenter_ids: [1, 2],
    ...overrides,
  });

  it('reads completed trades into what each side received', () => {
    const [trade, ...rest] = parseTrades([
      tx({}),
      tx({ transaction_id: 'w', type: 'waiver' }),
      tx({ transaction_id: 'f', status: 'failed' }),
    ]);
    expect(rest).toEqual([]);
    expect(trade.week).toBe(3);
    expect(trade.sides).toEqual([
      { rosterId: 1, receives: ['p2'], sends: ['p1'], picks: [], faab: 10 },
      { rosterId: 2, receives: ['p1'], sends: ['p2'], picks: ['2027 round 2'], faab: -10 },
    ]);
  });

  it("counts received players' points only in weeks they started", () => {
    const week = (starters: string[], points: Record<string, number>): SleeperMatchup[] => [
      { roster_id: 1, matchup_id: 1, points: 100, starters, players: [...starters, 'bench'], players_points: points },
    ];
    const matchups = {
      3: week(['p2', 'x'], { p2: 12.5, x: 5 }),
      4: week(['x'], { p2: 30, x: 5 }), // p2 on the bench
      5: week(['p2'], { p2: 7 }),
    };
    expect(starterPoints(['p2'], 1, matchups, 3, 5)).toEqual({ points: 19.5, starts: 2 });
    expect(starterPoints(['p2'], 1, matchups, 4, 4)).toEqual({ points: 0, starts: 0 });
  });
});
