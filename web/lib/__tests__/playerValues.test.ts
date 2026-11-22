import { describe, expect, it } from 'vitest';
import { carriedValues, currentValues, valuesAsOf, type ProjectedPlayer, type SeasonProduction } from '@/lib/oddsData';
import { playerValue } from '@/lib/analyze/playoffOdds';

const P = (points: number, team = 'KC', injury: string | null = null): ProjectedPlayer => ({ position: 'RB', points, name: 'x', team, injury });
const none: SeasonProduction = { points: {}, games: {}, playedWeeks: {} };
// KC plays every week but 13 (its bye); SEA every week
const schedule = Object.fromEntries([11, 12, 13, 14, 15].map((w) => [w, new Set(w === 13 ? ['SEA'] : ['KC', 'SEA'])]));
const weeks = [11, 12, 13, 14, 15];

describe('player values for grading the past (carriedValues)', () => {
  it('carries the week-11 projection forward, zero on his bye', () => {
    const byWeek = { 11: { a: P(15) }, 12: { a: P(30) }, 13: { a: P(0) }, 14: { a: P(30) }, 15: { a: P(30) } };
    const v = carriedValues(11, byWeek, weeks, none, schedule);
    expect(weeks.map((w) => v[w].a.points)).toEqual([15, 15, 0, 15, 15]);
  });

  it('counts a player out that week from the first week he is projected back (Kenneth Walker, 2026)', () => {
    const byWeek = { 11: { a: P(0) }, 12: { a: P(0) }, 13: { a: P(0) }, 14: { a: P(18) }, 15: { a: P(20) } };
    const v = carriedValues(11, byWeek, weeks, none, schedule);
    expect(weeks.map((w) => v[w].a.points)).toEqual([0, 0, 0, 18, 18]);
  });

  it('a player on bye that week goes by the next week he plays (the backtested bye fix)', () => {
    const sched = { ...schedule, 11: new Set(['SEA']), 13: new Set(['KC', 'SEA']) };
    const byWeek = { 11: { a: P(0) }, 12: { a: P(12) }, 13: { a: P(40) }, 14: { a: P(40) }, 15: { a: P(40) } };
    const v = carriedValues(11, byWeek, weeks, none, sched);
    expect(weeks.map((w) => v[w].a.points)).toEqual([0, 12, 12, 12, 12]);
  });

  it('a player never projected again is worth nothing', () => {
    const byWeek = { 11: { a: P(0) }, 12: { a: P(0) }, 13: { a: P(0) }, 14: { a: P(0) }, 15: { a: P(0) } };
    const v = carriedValues(11, byWeek, weeks, none, schedule);
    expect(weeks.every((w) => v[w].a.points === 0)).toBe(true);
  });

  it('blends with season production like the odds model', () => {
    const prod: SeasonProduction = { points: { a: 200 }, games: { a: 10 }, playedWeeks: { a: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } };
    const v = carriedValues(11, { 11: { a: P(15) } }, [11], prod, schedule);
    expect(v[11].a.points).toBeCloseTo(playerValue(15, 200, 10), 9);
  });
});

describe('valuesAsOf', () => {
  const byWeek = { 11: { a: P(0, 'KC', 'Out') }, 12: { a: P(18, 'KC', 'Out') }, 13: { a: P(0, 'KC', 'Out') }, 14: { a: P(21, 'KC', 'Out') }, 15: { a: P(20, 'KC', 'Out') } };

  it('a week still to be played uses exactly the live values (the trade calculator and Playoffs tab)', () => {
    expect(valuesAsOf(11, byWeek, weeks, none, schedule, 10)).toEqual(currentValues(byWeek, weeks, none, schedule, 10).values);
  });

  it('a week already played uses the carried values', () => {
    expect(valuesAsOf(11, byWeek, weeks, none, schedule, 12)).toEqual(carriedValues(11, byWeek, weeks, none, schedule));
  });

  it('never writes off for the season a player out now who is projected back', () => {
    for (const lastScored of [10, 12]) {
      const v = valuesAsOf(11, byWeek, weeks, none, schedule, lastScored);
      expect(Math.max(...weeks.map((w) => v[w]?.a?.points ?? 0))).toBeGreaterThan(0);
    }
  });
});
