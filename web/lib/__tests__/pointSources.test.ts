import { describe, it, expect } from 'vitest';
import { averageTeam, pointSources, slope } from '../analyze/pointSources';
import type { SeasonInsights, TeamWeek, WaiverMove } from '../analyze/insights';
import type { DraftPickData } from '../analyze/draft';
import type { TradeHistoryEntry } from '../analyze/trade';

const week = (w: number, playerPoints: Record<string, number>, starters = Object.keys(playerPoints)): TeamWeek => ({
  week: w,
  opponent: null,
  points: starters.reduce((s, id) => s + (playerPoints[id] ?? 0), 0),
  opponentPoints: null,
  optimal: 0,
  projected: null,
  starters,
  playerPoints,
  starterProjections: {},
});
const pick = (rosterId: number, playerId: string) => ({ roster_id: rosterId, player_id: playerId }) as DraftPickData;
const pickup = (rosterId: number, playerId: string, w: number): WaiverMove => ({
  week: w,
  rosterId,
  playerId,
  type: 'free_agent',
  bid: null,
  losingBids: [],
  dropped: [],
  startedPoints: 0,
  startedWeeks: 0,
});
const trade = (w: number, sides: Array<[number, string[]]>) =>
  ({ id: `t${w}`, week: w, effectiveWeek: w, sides: sides.map(([rosterId, receives]) => ({ rosterId, receives, sends: [], picks: [], faab: 0 })) }) as unknown as TradeHistoryEntry;

const insights = (teams: Record<number, TeamWeek[]>, waivers: WaiverMove[] = []): SeasonInsights => ({
  season: '2024',
  regularSeasonEnd: 3,
  weeks: 3,
  complete: true,
  faabBudget: null,
  faabUsed: {},
  players: {},
  teams,
  waivers,
  generatedAt: '',
});

describe('pointSources', () => {
  it('credits each start to how the team got the player, summing to its lineup points (regular season only)', () => {
    const ins = insights(
      {
        1: [week(1, { qb: 20, rb: 10 }), week(2, { qb: 15, fa: 8 }), week(3, { qb: 12, wr: 9 }), week(4, { qb: 99 })],
        2: [week(1, { x: 5 })],
      },
      [pickup(1, 'fa', 2)]
    );
    const [one, two] = pointSources(ins, [pick(1, 'qb'), pick(1, 'rb'), pick(2, 'x'), pick(2, 'wr')], [trade(3, [[1, ['wr']], [2, []]])]);
    expect(one.points).toEqual({ drafted: 57, pickups: 8, trades: 9, other: 0 });
    // Week 4 is past the regular season
    expect(one.total).toBe(74);
    expect(two.points.drafted).toBe(5);
  });

  it('counts a player traded away and back as a trade, and one dropped and re-added as a pickup', () => {
    const ins = insights({ 1: [week(1, { a: 1, b: 1 }), week(2, { a: 2, b: 2 }), week(3, { a: 4, b: 4 })] }, [pickup(1, 'b', 3)]);
    const [one] = pointSources(ins, [pick(1, 'a'), pick(1, 'b')], [trade(2, [[2, ['a']], [1, []]]), trade(3, [[1, ['a']], [2, []]])]);
    // a: drafted weeks 1-2, back by trade in week 3; b: drafted weeks 1-2, re-added week 3
    expect(one.points).toEqual({ drafted: 6, pickups: 4, trades: 4, other: 0 });
  });

  it('marks a start with no acquisition as other', () => {
    const [one] = pointSources(insights({ 1: [week(1, { ghost: 3 })] }), [], []);
    expect(one.points.other).toBe(3);
  });

  it('averages the league and fits wins per point', () => {
    const avg = averageTeam([
      { rosterId: 1, points: { drafted: 10, pickups: 0, trades: 0, other: 0 }, total: 10 },
      { rosterId: 2, points: { drafted: 20, pickups: 4, trades: 0, other: 0 }, total: 24 },
    ]);
    expect(avg.points.drafted).toBe(15);
    expect(avg.total).toBe(17);
    expect(slope([100, 200, 300], [4, 6, 8])).toBeCloseTo(0.02);
    expect(slope([100, 100], [4, 6])).toBe(0);
  });
});
