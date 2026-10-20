import { describe, it, expect } from 'vitest';
import { bestLineupPoints, teamStrength } from '../analyze/playoffOdds';
import type { TradeDataResponse } from '../analyze/trade';
import { findPickups } from '../analyze/waiverFinder';

// Lineup: QB, RB, WR and two bench spots. Team 1's WR is on bye in week 8.
const ROSTER_POSITIONS = ['QB', 'RB', 'WR', 'BN', 'BN'];
const WEEKS = [7, 8, 9];
const flat = (pts: number) => Object.fromEntries(WEEKS.map((w) => [w, pts]));
const PROJ: Record<string, [string, Record<number, number>]> = {
  qbA: ['QB', flat(18)], rbA: ['RB', flat(12)], wrA: ['WR', { 7: 14, 8: 0, 9: 14 }], wrB: ['WR', flat(3)], rbX: ['RB', flat(2)],
  qbC: ['QB', flat(16)], rbC: ['RB', flat(12)], wrC: ['WR', flat(12)], wrD: ['WR', flat(5)], rbD: ['RB', flat(4)],
  // Free agents: a solid WR, a weaker one, and a QB who would only sit
  faWR: ['WR', flat(10)], faWR2: ['WR', flat(6)], faQB: ['QB', flat(15)],
};
const ROSTERS: Record<number, string[]> = { 1: ['qbA', 'rbA', 'wrA', 'wrB', 'rbX'], 2: ['qbC', 'rbC', 'wrC', 'wrD', 'rbD'] };

function league(): TradeDataResponse {
  const positions = Object.fromEntries(Object.entries(PROJ).map(([id, [pos]]) => [id, pos]));
  const projections = Object.fromEntries(Object.entries(PROJ).map(([id, [, p]]) => [id, p]));
  const lineups = Object.fromEntries(
    WEEKS.map((w) => [
      w,
      Object.fromEntries(
        Object.entries(ROSTERS).map(([r, ps]) => [
          r,
          bestLineupPoints(ps, Object.fromEntries(ps.map((p) => [p, { position: positions[p], points: projections[p][w] }])), ROSTER_POSITIONS, {}),
        ])
      ),
    ])
  );
  const { meanByWeek } = teamStrength({ 1: [100, 100], 2: [100, 100] }, WEEKS, lineups);
  return {
    open: true,
    season: '2026',
    currentWeek: 7,
    tradeDeadline: 11,
    regularSeasonEnd: 9,
    playoffWeekStart: 10,
    format: { playoffTeams: 1, hasDivisions: false, byes: 0 },
    hasToiletBowl: false,
    teams: [1, 2].map((id) => ({ rosterId: id, teamName: '', username: '', division: 0, wins: 1, losses: 1, ties: 0, pointsFor: 200 })),
    remaining: WEEKS.map((w) => ({ week: w, a: 1, b: 2 })),
    meanByWeek,
    spread: 20,
    inputs: { weeks: WEEKS, projections, positions, rosters: ROSTERS, freeAgents: ['faWR', 'faWR2', 'faQB'], streams: {}, rosterPositions: ROSTER_POSITIONS, lastScoredWeek: 6 },
    players: Object.fromEntries(
      Object.entries(PROJ).map(([id, [pos]]) => [
        id,
        { id, name: id, position: pos, team: null, injury: null, expectedPerWeek: 0, seasonPerGame: null, value: null, byeWeek: null },
      ])
    ),
    marketValues: false,
    generatedAt: '',
  };
}

describe('findPickups', () => {
  it('fills the bye week with the best free agent, dropping the least useful player', () => {
    const [top] = findPickups(league(), 1, { target: 8, sims: 1000 });
    expect(top.add).toBe('faWR');
    expect(top.drop).toEqual(['rbX']);
    expect(top.week).toMatchObject({ week: 8, opponent: 2 });
    // The 10-point WR replaces the 3-point backup filling in for the bye
    expect(top.week!.lineupAfter - top.week!.lineupBefore).toBeCloseTo(7);
    expect(top.week!.winAfter).toBeGreaterThan(top.week!.winBefore);
  });

  it('ranks the rest of the season by playoff odds and skips pickups that would just sit', () => {
    const results = findPickups(league(), 1, { target: 'season', sims: 1000 });
    expect(results[0].add).toBe('faWR');
    expect(results[0].week).toBeNull();
    // A backup QB never starts over an 18-point QB, so it doesn't help
    expect(results.some((r) => r.add === 'faQB')).toBe(false);
    for (const r of results) expect(r.odds[1].playoffs).toBeGreaterThan(r.odds[0].playoffs);
  });

  it('only suggests a week pickup that helps that week', () => {
    // Week 7: the WR plays, so a 10-point free agent only sits behind 14
    for (const r of findPickups(league(), 1, { target: 7, sims: 1000 })) {
      expect(r.week!.winAfter).toBeGreaterThan(r.week!.winBefore);
    }
  });
});
