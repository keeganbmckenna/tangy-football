import { describe, it, expect } from 'vitest';
import { teamWeeksFor, waiverMoves } from '../analyze/insights';
import type { SleeperMatchup, SleeperTransaction } from '../types';

const SLOTS = ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN'];
const POSITIONS: Record<string, string> = { q1: 'QB', q2: 'QB', r1: 'RB', r2: 'RB', w1: 'WR', w2: 'WR', t1: 'TE' };

describe('teamWeeksFor', () => {
  const matchups: SleeperMatchup[] = [
    // Benched q2 (30) and w2 (20), and started r2 (4) at FLEX
    { roster_id: 1, matchup_id: 1, points: 50, starters: ['q1', 'r1', 'w1', 'r2'], players: ['q1', 'r1', 'w1', 'r2', 'w2', 'q2'], players_points: { q1: 20, r1: 16, w1: 10, r2: 4, w2: 20, q2: 30 } },
    { roster_id: 2, matchup_id: 1, points: 60, starters: ['t1'], players: ['t1'], players_points: { t1: 60 } },
  ];
  const projections = { q1: { points: 18 }, r1: { points: 12 }, w1: { points: 11 }, r2: { points: 9 } };
  const weeks = teamWeeksFor(3, matchups, projections, POSITIONS, SLOTS);

  it('finds the best lineup the roster could have started', () => {
    // q2 at QB, r1, w2, and w1 at FLEX (a QB can't play FLEX, so q1 sits)
    expect(weeks[1].optimal).toBe(76);
    expect(weeks[1].points).toBe(50);
  });

  it('records the opponent, starters and their projections', () => {
    expect(weeks[1]).toMatchObject({ week: 3, opponent: 2, opponentPoints: 60, projected: 50, starters: ['q1', 'r1', 'w1', 'r2'] });
    expect(weeks[1].starterProjections.r2).toBe(9);
    expect(weeks[1].playerPoints.w2).toBe(20);
    // Never below what the lineup scored, even when a starter's position is unknown
    expect(weeks[2].optimal).toBe(60);
  });

  it('scores the lineup the projections recommended at the points everyone scored', () => {
    // By projection: q1 (q2 unprojected), r1, w1, and r2 (9) at FLEX over w2 (unprojected): what it started
    expect(weeks[1].projectedBest).toBe(50);
    const benchW2 = teamWeeksFor(3, matchups, { ...projections, w2: { points: 15 } }, POSITIONS, SLOTS);
    // With w2 projected 15 he'd take FLEX from r2: 20 + 16 + 20 + 10
    expect(benchW2[1].projectedBest).toBe(66);
    expect(teamWeeksFor(3, matchups, null, POSITIONS, SLOTS)[1].projectedBest).toBeNull();
  });
});

describe('waiverMoves', () => {
  const tx = (t: Partial<SleeperTransaction>): SleeperTransaction => ({
    type: 'waiver', transaction_id: Math.random().toString(), status: 'complete', leg: 2, settings: null, roster_ids: [1],
    adds: null, drops: null, created: 0, status_updated: 0, creator: '', consenter_ids: [], ...t,
  });
  const teams = {
    1: [2, 3, 4].map((week) => ({
      week, opponent: 2, points: 100, opponentPoints: 90, optimal: 110, projected: 100,
      starters: week === 3 ? [] : ['w9'], playerPoints: { w9: 12 }, starterProjections: {},
    })),
  };

  it('counts what a pickup scored in the new team’s lineup, and the bids it beat', () => {
    const moves = waiverMoves(
      [
        tx({ adds: { w9: 1 }, drops: { w1: 1 }, settings: { waiver_bid: 30 } }),
        tx({ status: 'failed', roster_ids: [3], adds: { w9: 3 }, settings: { waiver_bid: 25 }, metadata: { notes: 'This player was claimed by another owner.' } }),
        tx({ status: 'failed', roster_ids: [4], adds: { w9: 4 }, settings: { waiver_bid: 50 }, metadata: { notes: 'Roster is full.' } }),
      ],
      teams
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ rosterId: 1, playerId: 'w9', bid: 30, dropped: ['w1'], startedPoints: 24, startedWeeks: 2 });
    expect(moves[0].losingBids).toEqual([{ rosterId: 3, bid: 25 }]);
  });
});
