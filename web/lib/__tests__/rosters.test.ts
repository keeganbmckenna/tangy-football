import { describe, it, expect } from 'vitest';
import type { SeasonInsights, TeamWeek } from '../analyze/insights';
import { lineupEfficiency, lineupSwaps, playerLeaders, positionPoints, teamMvps, usedFaab, vsProjections, waiverTeams } from '../analyze/rosters';

const SLOTS = ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN'];
const PLAYERS = {
  q1: { name: 'Q One', position: 'QB', team: 'A' },
  r1: { name: 'R One', position: 'RB', team: 'A' },
  r2: { name: 'R Two', position: 'RB', team: 'B' },
  w1: { name: 'W One', position: 'WR', team: 'B' },
  w2: { name: 'W Two', position: 'WR', team: 'C' },
  t1: { name: 'T One', position: 'TE', team: 'C' },
};

const week = (w: number, starters: string[], playerPoints: Record<string, number>, opponentPoints: number, optimal: number, proj?: Record<string, number>): TeamWeek => ({
  week: w,
  opponent: 2,
  points: starters.reduce((s, id) => s + (playerPoints[id] ?? 0), 0),
  opponentPoints,
  optimal,
  projected: proj ? Object.values(proj).reduce((s, v) => s + v, 0) : null,
  starters,
  playerPoints,
  starterProjections: proj ?? {},
});

function insights(): SeasonInsights {
  return {
    season: '2025', regularSeasonEnd: 14, weeks: 2, complete: false, faabBudget: 100, faabUsed: { 1: 40, 2: 0 },
    players: PLAYERS,
    teams: {
      // Week 1: started w1 (5) at FLEX over the benched w2 (20) and lost 52-60; the best lineup scores 67
      1: [
        week(1, ['q1', 'r1', 'w1', 'r2'], { q1: 20, r1: 12, w1: 15, r2: 5, w2: 20 }, 60, 67, { q1: 18, r1: 14, w1: 12, r2: 9 }),
        week(2, ['q1', 'r1', 'w2', 'w1'], { q1: 25, r1: 10, w2: 30, w1: 10, r2: 2 }, 50, 75, { q1: 18, r1: 14, w2: 12, w1: 12 }),
      ],
      2: [week(1, ['t1'], { t1: 60 }, 52, 60), week(2, ['t1'], { t1: 50 }, 75, 50)],
    },
    waivers: [
      { week: 1, rosterId: 1, playerId: 'w2', type: 'waiver', bid: 0, losingBids: [], dropped: [], startedPoints: 30, startedWeeks: 1 },
    ],
    generatedAt: '',
  };
}

describe('lineup decisions', () => {
  it('pairs each benched player with the starter he should have replaced, by position first', () => {
    const w = insights().teams[1][0];
    const positions = Object.fromEntries(Object.entries(PLAYERS).map(([id, p]) => [id, p.position]));
    // Best: q1, r1, w2 at WR, w1 at FLEX (15 > r2's 5); so w2 comes in for r2 at FLEX
    expect(lineupSwaps(w, positions, SLOTS)).toEqual([{ in: 'w2', out: 'r2', gain: 15 }]);
  });

  it('counts points left on the bench and losses the best lineup would have won', () => {
    const t1 = lineupEfficiency(insights(), SLOTS).find((t) => t.rosterId === 1)!;
    expect(t1.points).toBe(52 + 75);
    expect(t1.leftOnBench).toBe(67 - 52);
    expect(t1.flippedLosses).toBe(1);
    expect(t1.perfectWeeks).toBe(1);
    expect(t1.costliest).toMatchObject({ week: 1, flipped: true });
  });

  it('adds up start/sit calls against the lineup the projections recommended, where known', () => {
    const data = insights();
    data.teams[1][0].projectedBest = 55;
    const t1 = lineupEfficiency(data, SLOTS).find((t) => t.rosterId === 1)!;
    expect(t1.startSit).toBe(52 - 55);
    expect(t1.startSitWeeks).toBe(1);
    expect(lineupEfficiency(insights(), SLOTS).find((t) => t.rosterId === 1)!.startSit).toBeNull();
  });
});

describe('projections, positions and players', () => {
  it('tracks starters against their projections', () => {
    const t1 = vsProjections(insights()).find((t) => t.rosterId === 1)!;
    expect(t1.byWeek.map((w) => w.diff)).toEqual([52 - 53, 75 - 56]);
    expect(t1.byWeek[1].cumulative).toBe(18);
    expect(t1.players[0]).toMatchObject({ playerId: 'w2', diff: 18 });
  });

  it('splits starters’ points by position and finds the top scorer’s share', () => {
    const t1 = positionPoints(insights()).find((t) => t.rosterId === 1)!;
    expect(t1.byPosition).toEqual({ QB: 45, RB: 27, WR: 55 });
    expect(t1.top).toMatchObject({ playerId: 'q1', points: 45 });
    expect(t1.top!.share).toBeCloseTo(45 / 127);
  });

  it('ranks players by points in starting lineups, and each team’s MVP', () => {
    const { seasons, games } = playerLeaders(insights());
    expect(seasons[0]).toMatchObject({ playerId: 't1', started: 110, starts: 2, rosters: [2] });
    expect(games[0]).toMatchObject({ playerId: 't1', week: 1, points: 60 });
    expect(teamMvps(seasons).get(1)).toEqual({ playerId: 'q1', points: 45 });
  });
});

describe('waivers', () => {
  it('uses Sleeper’s FAAB spent, and knows a season without bids', () => {
    const data = insights();
    expect(waiverTeams(data).find((t) => t.rosterId === 1)).toMatchObject({ moves: 1, spent: 40, startedPoints: 30 });
    expect(usedFaab(data)).toBe(false);
    data.waivers[0].bid = 12;
    expect(usedFaab(data)).toBe(true);
  });
});
