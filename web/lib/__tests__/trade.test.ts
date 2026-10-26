import { describe, it, expect } from 'vitest';
import {
  earlierTradeModel,
  expectedWins,
  lineupByWeek,
  meansAfterTrade,
  normalCdf,
  parseTrades,
  rosterAfterTrade,
  starterPoints,
  tradeSeasonOdds,
  weeklyOutlook,
  weeklyWinProbability,
  type TradeInputs,
  type TradeModel,
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

// A trade model like the trade-data route builds: season means (and the weight on a trade's average
// lineup change) and single-game margins (with each week's weight and spread)
const tradeModel = (season: Record<number, Record<number, number>>, games: Record<number, Record<number, number>>): TradeModel => ({
  season: { meanByWeek: season, spread: 25, teamSpread: 0, lineupWeight: 0.4 },
  games: { meanByWeek: games, spreadByWeek: { 7: 22, 8: 24 }, lineupWeightByWeek: { 7: 0.8, 8: 0.3 } },
});

describe('trade effect', () => {
  it("moves the season means by the lineup weight times the average change, and each game by that week's weight", () => {
    const inp = inputs();
    const before = tradeModel({ 7: { 1: 100, 2: 100 }, 8: { 1: 100, 2: 100 }, 15: { 1: 100, 2: 100 } }, { 7: { 1: 0, 2: 0 }, 8: { 1: 0, 2: 0 } });
    const changes = [
      rosterAfterTrade(inp, { rosterId: 1, sends: ['wr2'], receives: ['wr4'] }),
      rosterAfterTrade(inp, { rosterId: 2, sends: ['wr4'], receives: ['wr2'] }),
    ];
    const { model, lineupDelta } = meansAfterTrade(before, inp, changes);
    // Team 1: wr4 (16) starts at WR and wr1 (14) moves to FLEX over rb2 (10): 59 -> 65
    expect(lineupDelta[1][7]).toBe(6);
    expect(model.season.meanByWeek[7][1]).toBeCloseTo(100 + 0.4 * 6);
    // the season move is the same in every week, playoff weeks too
    expect(model.season.meanByWeek[15][1]).toBeCloseTo(100 + 0.4 * 6);
    expect(model.games.meanByWeek[7][1]).toBeCloseTo(0.8 * 6);
    expect(model.games.meanByWeek[8][1]).toBeCloseTo(0.3 * 6);
    // Team 2 loses its best WR: wr5 (9) moves up, rb4 (5) leaves the FLEX for wr2 (8)
    expect(lineupDelta[2][7]).toBe(-8);
    // The input isn't changed
    expect(before.season.meanByWeek[7][1]).toBe(100);
  });

  it('turns each team into the other when they swap whole rosters', () => {
    const inp = { ...inputs(), weeks: [7] };
    // Team strength as the fitted model builds it: a weight on the lineup plus the team's own season form
    const lineup = (r: number) => lineupByWeek(inp, inp.rosters[r])[7];
    const form = { 1: -5, 2: 5 };
    const before = tradeModel(
      { 7: { 1: 100 + 0.4 * lineup(1) + form[1], 2: 100 + 0.4 * lineup(2) + form[2] } },
      { 7: { 1: 0.8 * lineup(1) + form[1], 2: 0.8 * lineup(2) + form[2] } }
    );
    const changes = [
      rosterAfterTrade(inp, { rosterId: 1, sends: inp.rosters[1], receives: inp.rosters[2] }),
      rosterAfterTrade(inp, { rosterId: 2, sends: inp.rosters[2], receives: inp.rosters[1] }),
    ];
    const { model } = meansAfterTrade(before, inp, changes);
    // Team 1 now has team 2's lineup; only its own season form stays
    expect(model.season.meanByWeek[7][1]).toBeCloseTo(100 + 0.4 * lineup(2) + form[1]);
    expect(model.games.meanByWeek[7][2]).toBeCloseTo(0.8 * lineup(1) + form[2]);
  });

  it('leaves everything unchanged for an empty trade', () => {
    const inp = inputs();
    const before = tradeModel({ 7: { 1: 100, 2: 95 }, 8: { 1: 100, 2: 95 } }, { 7: { 1: 2, 2: -2 }, 8: { 1: 2, 2: -2 } });
    const { model } = meansAfterTrade(before, inp, [rosterAfterTrade(inp, { rosterId: 1, sends: [], receives: [] })]);
    expect(model).toEqual(before);
  });

  it('falls back to the earlier model: 75% of each change, 0.8x the spread next week and 2x after', () => {
    const m = earlierTradeModel({ 7: { 1: 105, 2: 95 }, 8: { 1: 105, 2: 95 } }, 25, 6, [7, 8]);
    expect(m.games.spreadByWeek).toEqual({ 7: 0.8 * 25, 8: 2 * 25 });
    expect(m.games.lineupWeightByWeek[7]).toBe(0.75);
    expect(m.season.teamSpread).toBe(0);
  });
});

describe('weekly win odds', () => {
  it('uses a standard normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });

  it('is 50% for equal teams and less confident with a wider spread', () => {
    expect(weeklyWinProbability(100, 100, 25)).toBeCloseTo(0.5);
    const tight = weeklyWinProbability(110, 100, 20);
    const wide = weeklyWinProbability(110, 100, 40);
    expect(tight).toBeGreaterThan(wide);
    expect(wide).toBeGreaterThan(0.5);
  });

  it("lists a team's remaining games with its opponent", () => {
    const remaining = [
      { week: 8, a: 2, b: 1 },
      { week: 7, a: 1, b: 3 },
      { week: 7, a: 2, b: 4 },
    ];
    const model = tradeModel({}, { 7: { 1: 10, 2: 0, 3: 0, 4: 0 }, 8: { 1: 0, 2: 0, 3: 0, 4: 0 } });
    const outlook = weeklyOutlook(1, remaining, model);
    expect(outlook.map((o) => [o.week, o.opponent])).toEqual([[7, 3], [8, 2]]);
    expect(outlook[0].winProbability).toBeCloseTo(normalCdf(10 / (22 * Math.SQRT2)));
    expect(outlook[1].winProbability).toBeCloseTo(0.5);
    expect(expectedWins(1, remaining, model)).toBeCloseTo(outlook[0].winProbability + 0.5);
  });
});

describe('tradeSeasonOdds', () => {
  const teams = Array.from({ length: 12 }, (_, i) => ({
    rosterId: i + 1, teamName: '', username: '', division: (i % 3) + 1, wins: 3, losses: 3, ties: 0, pointsFor: 600 + i,
  }));
  const remaining = [7, 8, 9].flatMap((w) => Array.from({ length: 6 }, (_, i) => ({ week: w, a: i * 2 + 1, b: i * 2 + 2 })));
  const means = (bump: number) =>
    tradeModel(
      Object.fromEntries([7, 8, 9, 15, 16, 17].map((w) => [w, Object.fromEntries(teams.map((t) => [t.rosterId, 100 + (t.rosterId === 5 ? bump : 0)]))])),
      {}
    );
  const format = { playoffTeams: 6, hasDivisions: true, byes: 2 };

  it('gives identical odds for an unchanged team (same random draws)', () => {
    const { before, after } = tradeSeasonOdds(teams, remaining, format, means(0), means(0), 15, true, 2000);
    expect(after.teams[5]).toEqual(before.teams[5]);
  });

  it('raises the odds of a team that gets stronger', () => {
    const { before, after } = tradeSeasonOdds(teams, remaining, format, means(0), means(8), 15, true, 2000);
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
    expect(starterPoints(['p2'], 1, matchups, 3, 5)).toEqual({ points: 19.5, starts: 2, byPlayer: { p2: 19.5 } });
    expect(starterPoints(['p2'], 1, matchups, 4, 4)).toEqual({ points: 0, starts: 0, byPlayer: {} });
  });
});
