import { describe, it, expect } from 'vitest';
import { asShown, percent, pointsChange, signed } from '../format';
import { calculateStandingsOverTime } from '../analyze/timeSeries';
import type { TeamStats } from '../types';

describe('signed', () => {
  it('rounds before choosing the sign, so nothing shows as −0.0', () => {
    expect(signed(-0.04)).toBe('0.0');
    expect(signed(0.04)).toBe('0.0');
    expect(signed(-0.545)).toBe('−0.5');
    expect(signed(1.25, 2)).toBe('+1.25');
    expect(signed(0)).toBe('0.0');
  });
});

describe('asShown and pointsChange', () => {
  it('compare by the numbers people see', () => {
    expect(asShown(0.46)).toBe(0.5);
    // 69.5% and 70.4% both show as 70%: no change
    expect(pointsChange(0.695, 0.704)).toBe(0);
    expect(pointsChange(0.404, 0.696)).toBe(30);
  });

  it('never shows an undecided chance as 100% or 0%', () => {
    expect(percent(0.996)).toBe('>99%');
    expect(percent(1)).toBe('100%');
    expect(percent(0.003)).toBe('<1%');
    expect(percent(0.494)).toBe('49%');
    expect(percent(0.62, '')).toBe('62');
  });
});

describe('standings over time', () => {
  it('counts a tie as half a win', () => {
    const team = (username: string, results: Array<'W' | 'L' | 'T'>, scores: number[]) =>
      ({ username, weeklyResults: results, weeklyScores: scores }) as TeamStats;
    // After week 2: A is 1-0-1 (1.5), B is 1-1 (1) with more points: A ranks first
    const standings = calculateStandingsOverTime([team('a', ['W', 'T'], [100, 90]), team('b', ['L', 'W'], [150, 150])], 2);
    expect(standings.a[1]).toBe(1);
    expect(standings.b[1]).toBe(2);
  });
});
