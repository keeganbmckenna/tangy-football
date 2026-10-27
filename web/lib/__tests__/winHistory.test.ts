import { describe, it, expect } from 'vitest';
import { biggestPlays, cleanPlay, dropRetractions, isBigPlay, liveEvents, matchPlay, playersInPlay, type PlayEvent } from '../winHistory';

const ev = (t: number, players: PlayEvent['players'], before = 0.5, after = 0.5): PlayEvent => ({ t, desc: null, players, before, after });

describe('cleanPlay', () => {
  it('keeps just the play: no QB hits, tacklers, snapper and holder, penalties or trivia', () => {
    expect(cleanPlay('J.Goff pass short middle to J.Williams for 10 yards, TOUCHDOWN [L.Van Ness].')).toBe('J.Goff pass short middle to J.Williams for 10 yards, TOUCHDOWN.');
    expect(cleanPlay('D.Maye pass deep left to S.Diggs to NE 42 for 16 yards (T.Bernard, L.Vander Esch).')).toBe('D.Maye pass deep left to S.Diggs to NE 42 for 16 yards.');
    expect(cleanPlay('D.Carlson 52 yard field goal is GOOD, Center-T.Sieg, Holder-A.Cole.')).toBe('D.Carlson 52 yard field goal is GOOD.');
    expect(cleanPlay('T.Heinicke sacked at WAS 38 for -12 yards (H.Reddick). PENALTY on PHI-B.Graham, Unnecessary Roughness, 15 yards, enforced at WAS 38.')).toBe(
      'T.Heinicke sacked at WAS 38 for -12 yards.'
    );
    expect(cleanPlay('L.Jackson pass short middle to M.Andrews for 5 yards, TOUCHDOWN. BAL 89-Andrews 31st career rec TD, 2nd in franchise history (Heap 41).')).toBe(
      'L.Jackson pass short middle to M.Andrews for 5 yards, TOUCHDOWN.'
    );
  });

  it('shortens replay reviews and drops what a cut-off description leaves', () => {
    expect(cleanPlay('R.Dowdle left guard for 1 yard, TOUCHDOWN. The Replay Official reviewed the runner broke the plane ruling, and the play was Upheld.')).toBe(
      'R.Dowdle left guard for 1 yard, TOUCHDOWN. Upheld on review.'
    );
    expect(cleanPlay('B.Perkins pass short right intended for V.Jefferson INTERCEPTED by N.Bolton at LA 42. N.Bolton to LA 27 for 15 yards (B.Perk')).toBe(
      'B.Perkins pass short right intended for V.Jefferson INTERCEPTED by N.Bolton at LA 42. N.Bolton to LA 27 for 15 yards'
    );
  });

  it('drops the clock, formation notes, eligibility reports and jersey numbers', () => {
    expect(cleanPlay('(8:01) 75-J.Travis reported in as eligible. 28-J.Taylor right end for 3 yards, TOUCHDOWN.')).toBe('J.Taylor right end for 3 yards, TOUCHDOWN.');
    expect(cleanPlay('(13:32) (No Huddle, Shotgun) 1-J.Hurts pass deep right to 26-S.Barkley for 47 yards (31-D.Williams).')).toBe(
      'J.Hurts pass deep right to S.Barkley for 47 yards.'
    );
    expect(cleanPlay('(:03) 10-D.Maye pass short right to 38-R.Stevenson for 48 yards, TOUCHDOWN.')).toBe('D.Maye pass short right to R.Stevenson for 48 yards, TOUCHDOWN.');
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
    expect(out[0].event.players).toEqual([{ side: 'a', name: 'Q', pts: 4.4, id: 'q' }, { side: 'a', name: 'W', pts: 7.1, id: 'w' }]);
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

describe('cleaning ESPN play text', () => {
  it('drops eligibility reports with or without a jersey number', () => {
    expect(cleanPlay('B.Jones reported in as eligible. J.Williams left tackle to PHI 25 for 34 yards.')).toBe('J.Williams left tackle to PHI 25 for 34 yards.');
    expect(cleanPlay('A.St. Brown reported in as ineligible. J.Goff pass short left to S.LaPorta for 8 yards.')).toBe('J.Goff pass short left to S.LaPorta for 8 yards.');
    expect(cleanPlay('68-B.Jones reported in as eligible. J.Williams up the middle for 3 yards.')).toBe('J.Williams up the middle for 3 yards.');
  });
});

describe('the play behind a live event', () => {
  // ESPN's play-by-play of DAL @ PHI, 2026 week 7: Makai Lemon's plays (wall-clock times)
  const plays = [
    { t: 1793063906, text: 'T.McKee pass incomplete short middle to M.Lemon (C.Downs). PENALTY on DAL-C.Downs, Defensive Pass Interference, 12 yards, enforced at PHI 30 - No Play.', scoring: false },
    { t: 1793066834, text: '(Shotgun) T.McKee pass short left to M.Lemon to DAL 39 for 9 yards (D.Overshown).', scoring: false },
    { t: 1793066876, text: 'T.McKee pass short left to M.Lemon pushed ob at DAL 24 for 15 yards (M.Bell).', scoring: false },
    { t: 1793067204, text: '(Shotgun) T.McKee pass short right to M.Lemon for 4 yards, TOUCHDOWN.', scoring: true },
  ];
  const event = (t: number, pts: number): PlayEvent => ({ t, desc: null, players: [{ side: 'b', name: 'M. Lemon', pts, id: 'x' }], before: 0.26, after: 0.46 });

  it('credits a touchdown-sized move to the touchdown, and a smaller one to the catches before it', () => {
    // Saved at 10:19 PM ET (+3.4: the 9- and 15-yard catches) and 10:22 (+6.9: the touchdown)
    expect(matchPlay(event(1793067540, 3.4), plays, 'Lemon', 1793067360 - 600)?.t).toBe(1793066876);
    expect(matchPlay(event(1793067720, 6.9), plays, 'Lemon', 1793067540 - 600)?.text).toContain('TOUCHDOWN');
  });

  it('skips plays a penalty wiped out, and finds nothing outside the window', () => {
    expect(matchPlay(event(1793064000, 1.5), plays, 'Lemon', 1793063000)).toBeNull();
    expect(matchPlay(event(1793067720, 6.9), plays, 'Lamb', 1793067000)).toBeNull();
  });
});

describe('playersInPlay', () => {
  const event = (desc: string | null, players: PlayEvent['players']): PlayEvent => ({ t: 0, desc, players, before: 0.46, after: 0.88 });

  it('keeps only the starters the play names', () => {
    const e = event('T.McKee pass short right to M.Lemon for 4 yards, TOUCHDOWN. J.Elliott extra point is GOOD.', [
      { side: 'a', name: 'J. Williams', pts: 0.6 },
      { side: 'b', name: 'M. Lemon', pts: 6.9 },
    ]);
    expect(playersInPlay(e).players.map((p) => p.name)).toEqual(['M. Lemon']);
  });

  it('keeps defenses, matches names with suffixes, and leaves an event naming nobody alone', () => {
    const e = event('M.Harrison pass deep left for 30 yards, TOUCHDOWN.', [
      { side: 'a', name: 'M. Harrison Jr.', pts: 9 },
      { side: 'b', name: 'Eagles', pts: -1 },
      { side: 'b', name: 'S. Barkley', pts: 1 },
    ]);
    expect(playersInPlay(e).players.map((p) => p.name)).toEqual(['M. Harrison Jr.', 'Eagles']);
    // A different Williams isn't this play's
    const other = event('J.Goff pass short left to J.Williams for 16 yards, TOUCHDOWN.', [
      { side: 'a', name: 'J. Williams', pts: 8.1 },
      { side: 'b', name: 'K. Williams', pts: 1.2 },
    ]);
    expect(playersInPlay(other).players.map((p) => p.name)).toEqual(['J. Williams']);
    const none = event('Timeout #1 by DAL.', [{ side: 'a', name: 'J. Williams', pts: 4 }]);
    expect(playersInPlay(none)).toBe(none);
    expect(playersInPlay(event(null, none.players)).players).toHaveLength(1);
  });

  it("keeps only the defenses in the play's game", () => {
    const e: PlayEvent = {
      ...event('T.McKee pass short right to M.Lemon for 4 yards, TOUCHDOWN.', [
        { side: 'b', name: 'M. Lemon', pts: 6.9, id: '1' },
        { side: 'a', name: 'Cowboys', pts: -1, id: 'DAL' },
        { side: 'a', name: 'Lions', pts: 2, id: 'DET' },
      ]),
      teams: ['PHI', 'DAL'],
    };
    expect(playersInPlay(e).players.map((p) => p.name)).toEqual(['M. Lemon', 'Cowboys']);
  });
});

describe('matchPlay incompletions', () => {
  it("doesn't credit a gain to an incomplete pass", () => {
    const e: PlayEvent = { t: 100, desc: null, players: [{ side: 'a', name: 'C. Lamb', pts: 5.4 }], before: 0.5, after: 0.6 };
    const plays = [
      { t: 50, text: 'D.Prescott pass short right to C.Lamb to PHI 30 for 22 yards.', scoring: false },
      { t: 90, text: 'D.Prescott pass incomplete short left to C.Lamb.', scoring: false },
    ];
    expect(matchPlay(e, plays, 'Lamb', 0)?.t).toBe(50);
  });
});

describe('matchPlay longest play', () => {
  it('credits a gain to the longest play, not a short one after it', () => {
    const e: PlayEvent = { t: 100, desc: null, players: [{ side: 'a', name: 'J. Williams', pts: 4.1 }], before: 0.15, after: 0.24 };
    const plays = [
      { t: 40, text: 'J.Williams left tackle to PHI 25 for 34 yards.', scoring: false },
      { t: 90, text: 'J.Williams left guard to PHI 9 for 2 yards.', scoring: false },
    ];
    expect(matchPlay(e, plays, 'Williams', 0)?.t).toBe(40);
  });
});

describe('cleanPlay injury updates', () => {
  it('drops a note after the play', () => {
    expect(cleanPlay('B.Corum left guard for 4 yards, TOUCHDOWN. B.McManus extra point is GOOD. ** Injury Update: P.Johnson has returned to the game.')).toBe(
      'B.Corum left guard for 4 yards, TOUCHDOWN. B.McManus extra point is GOOD.'
    );
  });
});

describe('cleanPlay notes and challenges', () => {
  it.each([
    [
      'T.Brady pass deep left to M.Evans pushed ob at ATL 1 for 40 yards. Tampa Bay challenged the short of the goal line ruling, and the play was Upheld. The ruling on the field stands. (Timeout #1.)',
      'T.Brady pass deep left to M.Evans pushed ob at ATL 1 for 40 yards. Upheld on review.',
    ],
    [
      'A.Dalton pass incomplete deep right to C.Olave. New Orleans challenged the incomplete pass ruling, and the play was REVERSED. A.Dalton pass deep right to C.Olave for 16 yards, TOUCHDOWN. He is Out.',
      'Reversed on review: A.Dalton pass deep right to C.Olave for 16 yards, TOUCHDOWN.',
    ],
    ['C.Stroud pass deep left to N.Collins to DEN 26 for 52 yards. His return is Questionable.', 'C.Stroud pass deep left to N.Collins to DEN 26 for 52 yards.'],
    ['M.Willis sacked at TEN 9 for -5 yards (sack split by C.Jones and C.Dunlap).', 'M.Willis sacked at TEN 9 for -5 yards.'],
    [
      'J.Fields sacked at NYG 35 for -8 yards. FUMBLES, RECOVERED by K.Thibodeaux at NYG 25. Officially, a sack for 0 Yards.',
      'J.Fields sacked at NYG 35 for -8 yards. FUMBLES, RECOVERED by K.Thibodeaux at NYG 25.',
    ],
    [
      'R.Wilson pass short left to C.Sutton for 7 yards, TOUCHDOWN. QB pressure: S.Lawson. Pass caught 8 yds. into end zone, along sideline.',
      'R.Wilson pass short left to C.Sutton for 7 yards, TOUCHDOWN.',
    ],
    ['M.Ryan sacked at IND 31 for -10 yards. FUMBLES, RECOVERED by S.Williams at IND 29. S.Williams for 29 yards, TOUCHDOWN. Reversed on review.', 'M.Ryan sacked at IND 31 for -10 yards. FUMBLES, RECOVERED by S.Williams at IND 29. S.Williams for 29 yards, TOUCHDOWN. Reversed on review.'],
  ])('%s', (raw, clean) => expect(cleanPlay(raw)).toBe(clean));
});

