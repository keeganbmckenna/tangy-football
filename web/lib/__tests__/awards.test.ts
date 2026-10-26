import { describe, it, expect } from 'vitest';
import { weekAwards } from '../analyze/awards';
import type { TeamWeek } from '../analyze/insights';
import type { WeekMatchup } from '../types';

const game = (id: number, a: [number, number], b: [number, number]): WeekMatchup => ({
  week: 3, matchupId: id,
  team1: { name: `T${a[0]}`, username: `u${a[0]}`, rosterId: a[0], points: a[1] },
  team2: { name: `T${b[0]}`, username: `u${b[0]}`, rosterId: b[0], points: b[1] },
  winner: a[1] > b[1] ? 'team1' : 'team2',
});
const tw = (points: number, optimal: number, projected: number): TeamWeek => ({
  week: 3, opponent: null, points, opponentPoints: null, optimal, projected, starters: [], playerPoints: {}, starterProjections: {},
});

describe('weekAwards', () => {
  const matchups = [game(1, [1, 150], [2, 90]), game(2, [3, 120], [4, 118])];

  it('finds the week’s high and low scores, blowout, closest game and luck', () => {
    const awards = Object.fromEntries(weekAwards(matchups).map((a) => [a.id, a]));
    expect(awards.high.rosterId).toBe(1);
    expect(awards.low.rosterId).toBe(2);
    expect(awards.blowout.detail).toBe('by 60.00');
    expect(awards.closest.rosterId).toBe(3);
    expect(awards.unlucky.rosterId).toBe(4);
    expect(awards.lucky.rosterId).toBe(3);
    expect(awards.bench).toBeUndefined();
  });

  it('adds the bench, upset and projection awards with lineups', () => {
    const weeks = new Map([[1, tw(150, 150, 110)], [2, tw(90, 100, 100)], [3, tw(120, 121, 100)], [4, tw(118, 140, 125)]]);
    const awards = Object.fromEntries(weekAwards(matchups, weeks).map((a) => [a.id, a]));
    expect(awards.bench).toMatchObject({ rosterId: 4, detail: '22.00 pts (would have won)' });
    expect(awards.upset).toMatchObject({ rosterId: 3, detail: 'projected to lose by 25.0' });
    expect(awards.over).toMatchObject({ rosterId: 1, detail: '+40.0' });
  });
});
