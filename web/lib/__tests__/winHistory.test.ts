import { describe, it, expect } from 'vitest';
import { biggestPlays, cleanPlay, dropRetractions, isBigPlay, liveEvents, type PlayEvent } from '../winHistory';

const ev = (t: number, players: PlayEvent['players'], before = 0.5, after = 0.5): PlayEvent => ({ t, desc: null, players, before, after });

describe('cleanPlay', () => {
  it('drops the clock, formation notes, eligibility reports and jersey numbers', () => {
    expect(cleanPlay('(8:01) 75-J.Travis reported in as eligible. 28-J.Taylor right end for 3 yards, TOUCHDOWN.')).toBe('J.Taylor right end for 3 yards, TOUCHDOWN.');
    expect(cleanPlay('(13:32) (No Huddle, Shotgun) 1-J.Hurts pass deep right to 26-S.Barkley for 47 yards (31-D.Williams).')).toBe(
      'J.Hurts pass deep right to S.Barkley for 47 yards (D.Williams).'
    );
    expect(cleanPlay('1-J.Hurts pass deep right to 26-S.Barkley for 47 yards, TOUCHDOWN. DEN-98-J.Franklin-Myers was injured during the play.')).toBe(
      'J.Hurts pass deep right to S.Barkley for 47 yards, TOUCHDOWN.'
    );
  });
});

describe('big plays', () => {
  it('counts a play as big by points for one side (combined) or by the odds swing', () => {
    // QB and receiver on the same side add up: 4.4 + 2.1 is big
    expect(isBigPlay(ev(1, [{ side: 'a', name: 'QB', pts: 4.4 }, { side: 'a', name: 'WR', pts: 2.1 }]))).toBe(true);
    expect(isBigPlay(ev(1, [{ side: 'a', name: 'WR', pts: 3 }]))).toBe(false);
    expect(isBigPlay(ev(1, [{ side: 'a', name: 'WR', pts: 3 }], 0.4, 0.55))).toBe(true);
  });

  it('keeps the biggest swings, in time order', () => {
    const plays = Array.from({ length: 12 }, (_, i) => ev(100 - i, [{ side: 'a', name: 'X', pts: 6 }], 0.5, 0.5 + i / 100));
    const kept = biggestPlays(plays, 8);
    expect(kept).toHaveLength(8);
    expect(kept.map((e) => e.t)).toEqual([...kept.map((e) => e.t)].sort((x, y) => x - y));
    expect(Math.min(...kept.map((e) => e.after - e.before))).toBeCloseTo(0.04);
  });
});

describe('live events', () => {
  const matchups = [{ matchupId: 1, a: ['q', 'w'], b: ['r'] }];
  it('records what changed between two saves when it is big', () => {
    const out = liveEvents({ t: 0, pts: { q: 10, w: 5, r: 8 }, odds: { 1: 0.5 } }, { t: 120, pts: { q: 14.4, w: 12.1, r: 8 }, odds: { 1: 0.7 } }, matchups, (id) => id.toUpperCase());
    expect(out).toHaveLength(1);
    expect(out[0].event).toMatchObject({ t: 120, desc: null, before: 0.5, after: 0.7 });
    expect(out[0].event.players).toEqual([{ side: 'a', name: 'Q', pts: 4.4 }, { side: 'a', name: 'W', pts: 7.1 }]);
    // Nothing big: nothing saved
    expect(liveEvents({ t: 0, pts: { q: 10 }, odds: { 1: 0.5 } }, { t: 120, pts: { q: 11 }, odds: { 1: 0.52 } }, matchups, (id) => id)).toEqual([]);
  });

  it('drops a score that was taken back, and the take-back', () => {
    const td = ev(1000, [{ side: 'a', name: 'J. Chase', pts: 7.2 }], 0.5, 0.65);
    const flag = ev(1300, [{ side: 'a', name: 'J. Chase', pts: -7.2 }], 0.65, 0.5);
    const real = ev(2000, [{ side: 'b', name: 'D. Henry', pts: 6.5 }], 0.5, 0.35);
    expect(dropRetractions([td, flag, real])).toEqual([real]);
    // Too long after to be a take-back: both stay
    const late = ev(1000 + 3600, [{ side: 'a', name: 'J. Chase', pts: -7.2 }]);
    expect(dropRetractions([td, late])).toHaveLength(2);
  });
});
