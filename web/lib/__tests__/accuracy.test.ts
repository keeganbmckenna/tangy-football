import { describe, it, expect } from 'vitest';
import { bands, brier, gameAccuracy, playoffAccuracy, wilson, type AccuracyData } from '../analyze/accuracy';

describe('wilson', () => {
  it('brackets the observed rate and narrows with more games', () => {
    const small = wilson(6, 10);
    const big = wilson(600, 1000);
    expect(small.low).toBeLessThan(0.6);
    expect(small.high).toBeGreaterThan(0.6);
    expect(big.high - big.low).toBeLessThan(small.high - small.low);
    // Never outside 0-1, even at the ends
    expect(wilson(0, 5).low).toBeCloseTo(0, 12);
    expect(wilson(5, 5).high).toBeCloseTo(1, 12);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe('bands', () => {
  it('groups by the odds given, the last band closed, empty bands left out', () => {
    const rows = [
      { p: 0.55, hit: true },
      { p: 0.58, hit: false },
      { p: 0.6, hit: true },
      { p: 1, hit: true },
    ];
    const b = bands(rows, [0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(b.map((x) => [x.lo, x.n])).toEqual([
      [0.5, 2],
      [0.6, 1],
      [0.9, 1],
    ]);
    expect(b[0].actual).toBe(0.5);
    expect(b[0].predicted).toBeCloseTo(0.565);
  });
});

describe('brier', () => {
  it('scores 0.25 for always 50%, 0 for certainty that came true', () => {
    expect(brier([{ p: 0.5, hit: true }, { p: 0.5, hit: false }])).toBe(0.25);
    expect(brier([{ p: 1, hit: true }])).toBe(0);
  });
});

describe('accuracy summaries', () => {
  const data: AccuracyData = {
    games: [
      { season: '2024', week: 1, p: 0.7, won: true },
      { season: '2024', week: 1, p: 0.6, won: false },
    ],
    playoffs: [
      { season: '2024', week: 3, p: 0.4, made: true },
      // Already in or out: left out
      { season: '2024', week: 13, p: 1, made: true },
      { season: '2024', week: 13, p: 0, made: false },
    ],
    generatedAt: '',
  };

  it('scores games from the favorite side', () => {
    const g = gameAccuracy(data);
    expect(g.n).toBe(2);
    expect(g.actual).toBe(0.5);
    expect(g.predicted).toBeCloseTo(0.65);
  });

  it('leaves teams already in or out out of the playoff odds', () => {
    expect(playoffAccuracy(data).n).toBe(1);
  });
});
