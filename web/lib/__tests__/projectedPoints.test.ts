import { describe, it, expect } from 'vitest';
import { projectedPoints } from '../oddsData';

describe('projected points', () => {
  // A 2025 week 5 QB projection as Sleeper serves it: its pts_half_ppr scores the 0.8
  // interceptions as +2 each (and lost fumbles too lightly), 2.37 points too many
  const qb = { pass_yd: 246.03, pass_td: 1.74, pass_int: 0.8, pass_2pt: 0.07, rush_yd: 35.33, rush_td: 0.61, rush_2pt: 0.03, fum_lost: 0.24, pts_half_ppr: 25.28 };

  it("scores a quarterback's projected stat line in half PPR, interceptions at -1", () => {
    expect(projectedPoints('QB', qb)).toBe(22.91);
  });

  it("keeps Sleeper's totals for the other positions", () => {
    expect(projectedPoints('WR', { rec: 6, rec_yd: 80, pts_half_ppr: 11.4 })).toBe(11.4);
    expect(projectedPoints('K', { pts_half_ppr: 8.1 })).toBe(8.1);
  });

  it('is 0 without a projection', () => {
    expect(projectedPoints('QB', undefined)).toBe(0);
    expect(projectedPoints('QB', {})).toBe(0);
  });
});
