import { describe, it, expect } from 'vitest';
import { backBy, missedStreak, returnRate } from '../analyze/availability';
import { discountInjured, type ProjectedPlayer, type SeasonProduction } from '../oddsData';

describe('injured players coming back', () => {
  it('uses the measured return rates, and no return from IR before 4 games', () => {
    expect(returnRate(1, false)).toBe(0.76);
    expect(returnRate(2, false)).toBe(0.4);
    expect(returnRate(6, false)).toBe(0.48);
    expect(returnRate(2, true)).toBe(0);
    expect(returnRate(4, true)).toBe(0.48);
  });

  it('adds up the chance of being back by a later game', () => {
    // Out two games: 40% for the next one, then 38%, then 48%...
    expect(backBy(2, 1, false)).toBeCloseTo(0.4);
    expect(backBy(2, 2, false)).toBeCloseTo(1 - 0.6 * 0.62);
    expect(backBy(2, 3, false)).toBeGreaterThan(backBy(2, 2, false));
    // On IR after one game: three more to sit, so back four games out at the earliest
    expect(backBy(1, 3, true)).toBe(0);
    expect(backBy(1, 4, true)).toBeCloseTo(0.48);
  });

  it('counts games missed in a row, back to the last one he played', () => {
    expect(missedStreak([1, 2, 3, 4, 5], new Set([1, 2, 3]))).toBe(2);
    expect(missedStreak([1, 2, 3, 4, 5], new Set([1, 2, 3, 4, 5]))).toBe(0);
    expect(missedStreak([1, 2, 4], new Set())).toBe(3);
  });

  const player = (injury: string | null, team = 'BAL'): ProjectedPlayer => ({ position: 'QB', points: 22, name: 'QB', team, injury });
  const schedule = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((w) => [w, new Set(['BAL', 'KC'])]));

  it("scales an out player's later weeks by his chance of being back", () => {
    // Played weeks 1-4, missed week 5, out this week (6), projected 22 from week 7 on
    const values: Record<number, Record<string, { position: string; points: number }>> = {};
    const players: Record<number, Record<string, ProjectedPlayer>> = {};
    for (const w of [6, 7, 8, 9]) {
      values[w] = { lamar: { position: 'QB', points: w === 6 ? 0 : 22 }, healthy: { position: 'QB', points: 20 } };
      players[w] = { lamar: player('Out'), healthy: player(null, 'KC') };
    }
    const production: SeasonProduction = { points: {}, games: {}, playedWeeks: { lamar: [1, 2, 3, 4], healthy: [1, 2, 3, 4, 5] } };
    discountInjured(values, players, production, schedule, 5, [6, 7, 8, 9]);
    expect(values[6].lamar.points).toBe(0);
    expect(values[7].lamar.points).toBeCloseTo(22 * 0.4);
    expect(values[8].lamar.points).toBeCloseTo(22 * (1 - 0.6 * 0.62));
    expect(values[9].healthy.points).toBe(20);
  });

  it('discounts a player hurt in his last game from this week on, as if he had missed one', () => {
    // Played weeks 1-5, ruled out after week 5's game; Sleeper still projects 15 every week
    const values: Record<number, Record<string, { position: string; points: number }>> = {};
    const players: Record<number, Record<string, ProjectedPlayer>> = {};
    for (const w of [6, 7, 8]) {
      values[w] = { evans: { position: 'WR', points: 15 }, maybe: { position: 'WR', points: 10 } };
      players[w] = { evans: { ...player('Out', 'KC'), position: 'WR' }, maybe: { ...player('Doubtful', 'KC'), position: 'WR' } };
    }
    const production: SeasonProduction = { points: {}, games: {}, playedWeeks: { evans: [1, 2, 3, 4, 5], maybe: [1, 2, 3, 4, 5] } };
    discountInjured(values, players, production, schedule, 5, [6, 7, 8]);
    expect(values[6].evans.points).toBeCloseTo(15 * 0.76);
    expect(values[7].evans.points).toBeCloseTo(15 * (1 - 0.24 * 0.6));
    expect(values[6].maybe.points).toBe(10);
  });

  it("discounts this week too when Sleeper still projects a player who's out", () => {
    // Missed week 5, out, and Sleeper projects 22 for this week (6) on anyway
    const values: Record<number, Record<string, { position: string; points: number }>> = {};
    const players: Record<number, Record<string, ProjectedPlayer>> = {};
    for (const w of [6, 7]) {
      values[w] = { lamar: { position: 'QB', points: 22 } };
      players[w] = { lamar: player('Out') };
    }
    const production: SeasonProduction = { points: {}, games: {}, playedWeeks: { lamar: [1, 2, 3, 4] } };
    discountInjured(values, players, production, schedule, 5, [6, 7]);
    expect(values[6].lamar.points).toBeCloseTo(22 * 0.76);
    expect(values[7].lamar.points).toBeCloseTo(22 * (1 - 0.24 * 0.6));
  });

  it('leaves a known timeline alone: Sleeper already has him out past next week', () => {
    const values: Record<number, Record<string, { position: string; points: number }>> = {};
    const players: Record<number, Record<string, ProjectedPlayer>> = {};
    for (const w of [6, 7, 8, 9]) {
      values[w] = { deebo: { position: 'WR', points: w < 9 ? 0 : 9.5 } };
      players[w] = { deebo: { ...player('Out', 'KC'), position: 'WR' } };
    }
    const production: SeasonProduction = { points: {}, games: {}, playedWeeks: { deebo: [1, 2, 3, 4] } };
    discountInjured(values, players, production, schedule, 5, [6, 7, 8, 9]);
    expect(values[9].deebo.points).toBe(9.5);
  });
});
