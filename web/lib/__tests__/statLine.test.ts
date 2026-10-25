import { describe, it, expect } from 'vitest';
import { formatStatLine, pickStats } from '../analyze/statLine';

// Real week 5 (2026) stat lines from Sleeper, trimmed
describe('box score lines', () => {
  it('quarterbacks: passing, then rushing', () => {
    const maye = pickStats({ pass_cmp: 26, pass_att: 34, pass_yd: 374, pass_td: 4, rush_att: 7, rush_yd: 25, rush_td: 1, pass_rtg: 150.9, gp: 1 });
    expect(formatStatLine('QB', maye)).toBe('26/34, 374 yd, 4 TD · 7 car, 25 yd, 1 TD');
  });

  it('running backs: rushing, then receptions/targets', () => {
    const gibbs = pickStats({ rush_att: 25, rush_yd: 151, rush_td: 2, rec: 5, rec_tgt: 6, rec_yd: 56 });
    expect(formatStatLine('RB', gibbs)).toBe('25 car, 151 yd, 2 TD · 5/6 rec, 56 yd');
    // A trick-play pass shows too
    expect(formatStatLine('RB', pickStats({ rush_att: 10, rush_yd: 40, pass_att: 1, pass_cmp: 1, pass_yd: 22, pass_td: 1 }))).toBe('10 car, 40 yd · 1/1, 22 yd, 1 TD');
  });

  it('receivers, with fumbles lost and two-point conversions', () => {
    expect(formatStatLine('WR', pickStats({ rec: 6, rec_tgt: 8, rec_yd: 143, rec_td: 2 }))).toBe('6/8 rec, 143 yd, 2 TD');
    expect(formatStatLine('TE', pickStats({ rec: 3, rec_tgt: 5, rec_yd: 22, rec_2pt: 1, fum_lost: 1 }))).toBe('3/5 rec, 22 yd · 1 2PT, 1 FL');
    expect(formatStatLine('WR', pickStats({ rec: 2, rec_tgt: 4, rec_yd: 30, rush_att: 2, rush_yd: 15, fum_rec_td: 1 }))).toBe('2/4 rec, 30 yd · 2 car, 15 yd · 1 FR TD');
  });

  it('kickers: field goals by distance and the longest, then extra points', () => {
    const myers = pickStats({ fga: 5, fgm: 5, fgm_40_49: 4, fgm_50_59: 1, fgm_50p: 1, fgm_lng: 50, xpa: 2, xpm: 2 });
    expect(formatStatLine('K', myers)).toBe('FG 5/5 (40s ×4, 50s ×1), lng 50 · XP 2/2');
    expect(formatStatLine('K', pickStats({ fga: 2, fgm: 1, fgm_30_39: 1, fgm_lng: 34, xpa: 3, xpm: 3 }))).toBe('FG 1/2 (30s ×1), lng 34 · XP 3/3');
  });

  it('defenses: plays, then points allowed (a shutout too), not the unscored yards allowed', () => {
    const sea = pickStats({ sack: 3, int: 1, fum_rec: 1, def_kr_yd: 126, pts_allow: 26, yds_allow: 269, tkl: 50 });
    expect(formatStatLine('DEF', sea)).toBe('3 sk, 1 INT, 1 FR, 126 ret yd · 26 PA');
    expect(formatStatLine('DEF', pickStats({ sack: 1, def_td: 1, pts_allow: 0, yds_allow: 188 }))).toBe('1 sk, 1 TD · 0 PA');
  });

  it("says what a defense's points allowed are worth during its game, and where the next bracket starts", () => {
    const scoring = { pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4 };
    const line = (pa: number) => formatStatLine('DEF', pickStats({ pts_allow: pa }), scoring);
    expect(line(0)).toBe('0 PA: 10 pts, 7 at 1');
    expect(line(14)).toBe('14 PA: 1 pt, 0 at 21');
    expect(line(27)).toBe('27 PA: 0 pts, \u22121 at 28');
    expect(line(40)).toBe('40 PA: \u22124 pts');
    // Brackets that score the same are skipped
    expect(formatStatLine('DEF', pickStats({ pts_allow: 3 }), { pts_allow_0: 5, pts_allow_1_6: 5, pts_allow_7_13: 2 })).toBe('3 PA: 5 pts, 2 at 7');
  });

  it('nothing for a player without stats', () => {
    expect(pickStats(undefined)).toBeNull();
    expect(pickStats({ gp: 0 })).toBeNull();
    expect(formatStatLine('WR', null)).toBe('');
  });
});
