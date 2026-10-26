import { describe, it, expect } from 'vitest';
import { luckBreakdown } from '../analyze/luck';
import { consistency, quantile } from '../analyze/consistency';
import { calculatePlayEveryoneStats } from '../analyze/playEveryone';
import type { TeamStats, WeekMatchup } from '../types';

// Four teams, three weeks: 1 v 2 and 3 v 4, then 1 v 3 and 2 v 4, then 1 v 4 and 2 v 3
const SCORES: Record<number, number[]> = { 1: [120, 95, 130], 2: [110, 100, 90], 3: [80, 105, 85], 4: [100, 140, 125] };
const PAIRS = [[[1, 2], [3, 4]], [[1, 3], [2, 4]], [[1, 4], [2, 3]]];

function league(): { teams: TeamStats[]; matchups: Record<number, WeekMatchup[]> } {
  const matchups: Record<number, WeekMatchup[]> = {};
  const results: Record<number, ('W' | 'L' | 'T')[]> = { 1: [], 2: [], 3: [], 4: [] };
  const opp: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] };
  PAIRS.forEach((pairs, w) => {
    matchups[w + 1] = pairs.map(([a, b], i) => {
      const [pa, pb] = [SCORES[a][w], SCORES[b][w]];
      results[a].push(pa > pb ? 'W' : 'L');
      results[b].push(pb > pa ? 'W' : 'L');
      opp[a].push(pb);
      opp[b].push(pa);
      return {
        week: w + 1, matchupId: i + 1,
        team1: { name: `T${a}`, username: `u${a}`, points: pa, rosterId: a },
        team2: { name: `T${b}`, username: `u${b}`, points: pb, rosterId: b },
      };
    });
  });
  const teams = [1, 2, 3, 4].map((id) => ({
    rosterId: id, teamName: `T${id}`, username: `u${id}`,
    wins: results[id].filter((r) => r === 'W').length, losses: results[id].filter((r) => r === 'L').length, ties: 0,
    totalPoints: 0, pointsAgainst: 0, avgPoints: 0, standing: 0, standingValue: 0,
    weeklyScores: SCORES[id], weeklyResults: results[id], weeklyOpponentScores: opp[id],
  })) as TeamStats[];
  return { teams, matchups };
}

describe('luckBreakdown', () => {
  const { teams, matchups } = league();
  const rows = luckBreakdown(teams, calculatePlayEveryoneStats(teams, 3), matchups, 3);

  it('measures luck as real minus expected wins', () => {
    for (const r of rows) expect(r.total).toBeCloseTo(r.wins - r.expectedWins);
    // Luck sums to zero across the league: every win is someone's loss
    expect(rows.reduce((s, r) => s + r.total, 0)).toBeCloseTo(0);
  });

  it('counts close games', () => {
    // Team 2: 110-120 (L by 10, not close), 100-140, 90-85 (W by 5, close)
    expect(rows.find((r) => r.rosterId === 2)!.close).toEqual({ wins: 1, losses: 0, ties: 0 });
  });
});

describe('consistency', () => {
  it('measures spread, floor, ceiling and boom and bust weeks against the league', () => {
    const { teams } = league();
    const { teams: rows, leagueQ1, leagueQ3 } = consistency(teams, 3);
    const t4 = rows.find((r) => r.rosterId === 4)!;
    expect(t4).toMatchObject({ floor: 100, ceiling: 140, median: 125 });
    expect(t4.sd).toBeCloseTo(20.21, 2);
    const all = Object.values(SCORES).flat().sort((a, b) => a - b);
    expect(leagueQ1).toBe(quantile(all, 0.25));
    expect(rows.reduce((s, r) => s + r.booms, 0)).toBe(all.filter((v) => v > leagueQ3).length);
  });
});
