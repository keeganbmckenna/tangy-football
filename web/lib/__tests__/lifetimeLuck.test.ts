import { describe, expect, it } from 'vitest';
import { lifetimeLuck } from '../analyze/lifetimeLuck';
import type { HistoryData, HistoryGame, HistorySeason } from '../analyze/history';

const g = (season: string, week: number, a: string, b: string, pa: number, pb: number, kind: HistoryGame['kind'] = 'regular'): HistoryGame => ({ season, week, a, b, pa, pb, kind });
const ids = ['u1', 'u2', 'u3', 'u4'];
const season = (s: string, extra: Partial<HistorySeason> = {}): HistorySeason => ({
  season: s, complete: true,
  teams: ids.map((u, i) => ({ userId: u, rosterId: i + 1, teamName: u, avatarUrl: null })),
  champion: null, runnerUp: null, toiletLoser: null, playoffTeams: [], placements: {},
  ...extra,
});

// u1 always scores most, u4 least; 2025 gives u2 two wins over u3's better scoring
const data: HistoryData = {
  managers: ids.map((id) => ({ userId: id, name: id, avatarUrl: null })),
  seasons: [season('2025', { complete: false }), season('2024'), season('2020', { legacy: true, standings: [{ userId: 'u1', wins: 13, losses: 0, rank: 1 }] })],
  games: [
    g('2024', 1, 'u1', 'u2', 140, 120), g('2024', 1, 'u3', 'u4', 110, 90),
    g('2024', 2, 'u1', 'u3', 135, 105), g('2024', 2, 'u2', 'u4', 115, 95),
    g('2024', 3, 'u1', 'u4', 130, 80), g('2024', 3, 'u2', 'u3', 112, 108),
    g('2025', 1, 'u1', 'u4', 150, 70), g('2025', 1, 'u2', 'u3', 101, 99),
    g('2025', 2, 'u1', 'u3', 140, 125), g('2025', 2, 'u2', 'u4', 95, 90),
    g('2025', 3, 'u1', 'u2', 0, 0), g('2025', 3, 'u3', 'u4', 0, 0),
    g('2024', 4, 'u1', 'u2', 99, 100, 'playoff'),
  ],
  generatedAt: '',
};

describe('lifetimeLuck', () => {
  const luck = lifetimeLuck(data, 2000);
  const row = (id: string) => luck.rows.find((r) => r.userId === id)!;

  it('counts Sleeper seasons and finished weeks only, regular season only', () => {
    expect(luck.seasons).toEqual(['2025', '2024']);
    expect(luck.inProgress).toBe('2025');
    expect(row('u1').record).toEqual({ wins: 5, losses: 0, ties: 0 });
    expect(row('u1').games).toBe(5);
  });

  it('gives a team that always outscores everyone no luck', () => {
    expect(row('u1').expected).toBeCloseTo(5, 6);
    expect(row('u1').luck).toBeCloseTo(0, 6);
    expect(row('u4').expected).toBeCloseTo(0, 6);
  });

  it('adds seasons up: expected wins are the seasons\' sum, and every win is someone\'s', () => {
    for (const r of luck.rows) expect(r.expected).toBeCloseTo(r.seasons.reduce((s, x) => s + x.expected, 0), 6);
    const total = luck.rows.reduce((s, r) => s + r.expected, 0);
    expect(total).toBeCloseTo(10, 6);
    for (const r of luck.rows) expect(r.outcomes.reduce((s, o) => s + o.frequency, 0)).toBeCloseTo(1, 6);
  });

  it('ranks the luckiest first, with percentiles and ranges that fit', () => {
    expect(luck.rows[0].userId).toBe('u2');
    expect(row('u2').luck).toBeGreaterThan(0);
    expect(row('u3').luck).toBeLessThan(0);
    for (const r of luck.rows) {
      expect(r.percentile).toBeGreaterThanOrEqual(0);
      expect(r.percentile).toBeLessThanOrEqual(1);
      expect(r.range[0]).toBeLessThanOrEqual(r.range[1]);
    }
  });

  it('records close games and the luckiest season', () => {
    expect(row('u2').close).toEqual({ wins: 3, losses: 0, ties: 0 });
    expect(row('u3').unluckiest?.season).toBeDefined();
  });

  it('is the same on every visit', () => {
    expect(lifetimeLuck(data, 2000).rows.map((r) => r.percentile)).toEqual(luck.rows.map((r) => r.percentile));
  });
});
