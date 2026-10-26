import { describe, it, expect } from 'vitest';
import { myLiveMatchupFirst, myWeekMatchupFirst } from '../analyze/myMatchup';
import type { WeekMatchup } from '../types';
import type { LiveMatchupOdds, LiveSide } from '../analyze/live';

const team = (rosterId: number, points: number) => ({ name: `T${rosterId}`, username: `u${rosterId}`, points, rosterId });
const week: WeekMatchup[] = [
  { week: 1, matchupId: 1, team1: team(1, 100), team2: team(2, 90), winner: 'team1' },
  { week: 1, matchupId: 2, team1: team(3, 80), team2: team(4, 120), winner: 'team2' },
  { week: 1, matchupId: 3, team1: team(5, 70), team2: team(6, 75), winner: 'team2' },
];

describe('my matchup first', () => {
  it('moves my matchup to the top with me on the left, the winner kept', () => {
    const out = myWeekMatchupFirst(week, 4);
    expect(out.map((m) => m.matchupId)).toEqual([2, 1, 3]);
    expect(out[0].team1.rosterId).toBe(4);
    expect(out[0].winner).toBe('team1');
  });

  it('leaves the order alone with no team picked, or one already on the left', () => {
    expect(myWeekMatchupFirst(week, null)).toBe(week);
    expect(myWeekMatchupFirst(week, 5).map((m) => m.matchupId)).toEqual([3, 1, 2]);
    expect(myWeekMatchupFirst(week, 5)[0]).toBe(week[2]);
  });

  it('flips live win odds with the sides', () => {
    const side = (rosterId: number) => ({ rosterId }) as LiveSide;
    const live: LiveMatchupOdds[] = [
      { matchupId: 1, a: side(1), b: side(2), aWinOdds: 0.7, sd: 20 },
      { matchupId: 2, a: side(3), b: side(4), aWinOdds: 0.25, sd: 20 },
    ];
    const [mine] = myLiveMatchupFirst(live, 4);
    expect([mine.a.rosterId, mine.b.rosterId, mine.aWinOdds]).toEqual([4, 3, 0.75]);
  });
});
