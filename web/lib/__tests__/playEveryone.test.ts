import { describe, it, expect } from 'vitest';
import {
  calculatePlayEveryoneStats,
  calculateWeeklyPlayAll,
  formatRecord,
  winPercentage,
} from '../analyze/playEveryone';
import type { TeamStats } from '../types';

function makeTeam(username: string, weeklyScores: number[], overrides: Partial<TeamStats> = {}): TeamStats {
  return {
    rosterId: 1,
    teamName: `${username} team`,
    username,
    wins: 0,
    losses: 0,
    ties: 0,
    totalPoints: 0,
    pointsAgainst: 0,
    avgPoints: 0,
    weeklyScores,
    weeklyResults: [],
    weeklyOpponentScores: [],
    standing: 0,
    standingValue: 0,
    ...overrides,
  };
}

describe('formatRecord', () => {
  it('omits ties when there are none', () => {
    expect(formatRecord(8, 3)).toBe('8-3');
    expect(formatRecord(8, 3, 0)).toBe('8-3');
  });

  it('shows ties when there are some', () => {
    expect(formatRecord(5, 5, 1)).toBe('5-5-1');
  });
});

describe('winPercentage', () => {
  it('counts a tie as half a win', () => {
    expect(winPercentage(5, 5, 1)).toBeCloseTo(5.5 / 11);
  });

  it('returns 0 with no games', () => {
    expect(winPercentage(0, 0, 0)).toBe(0);
  });
});

describe('calculateWeeklyPlayAll', () => {
  // Week 1: b and c tie at 100. Week 2: no ties.
  const teams = [
    makeTeam('a', [120, 90]),
    makeTeam('b', [100, 110]),
    makeTeam('c', [100, 80]),
  ];

  it('counts tied scores as ties', () => {
    const results = calculateWeeklyPlayAll(teams);
    const b = results.find((r) => r.username === 'b')!;
    expect(b.weeklyRecords[0]).toMatchObject({ wins: 0, losses: 1, ties: 1, winPct: 0.25 });
    expect(b.weeklyRecords[1]).toMatchObject({ wins: 2, losses: 0, ties: 0, winPct: 1 });
    expect(b).toMatchObject({ totalWins: 2, totalLosses: 1, totalTies: 1 });
    expect(b.overallWinPct).toBeCloseTo(2.5 / 4);
  });

  it('accounts for every opponent each week', () => {
    for (const team of calculateWeeklyPlayAll(teams)) {
      for (const r of team.weeklyRecords) expect(r.wins + r.losses + r.ties).toBe(teams.length - 1);
    }
  });

  it('respects maxWeek', () => {
    const [first] = calculateWeeklyPlayAll(teams, 1);
    expect(first.weeklyRecords).toHaveLength(1);
  });
});

describe('calculatePlayEveryoneStats', () => {
  it('counts play-all ties as half a win in expected wins', () => {
    const teams = [
      makeTeam('a', [120, 90], { wins: 2, losses: 0 }),
      makeTeam('b', [100, 110], { wins: 1, losses: 0, ties: 1 }),
      makeTeam('c', [100, 80], { wins: 0, losses: 2 }),
    ];
    const b = calculatePlayEveryoneStats(teams).find((r) => r.username === 'b')!;
    expect(b).toMatchObject({ playAllWins: 2, playAllLosses: 1, playAllTies: 1, actualTies: 1 });
    // (2 wins + 1 tie / 2) / 2 opponents
    expect(b.expectedWins).toBeCloseTo(1.25);
    // Actual 1 win + 1 tie / 2 = 1.5
    expect(b.difference).toBeCloseTo(0.25);
  });
});
