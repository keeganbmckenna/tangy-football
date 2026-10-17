import { describe, it, expect } from 'vitest';
import {
  allTimeStandings,
  bracketResults,
  headToHead,
  postseasonKind,
  recordBook,
  rivalries,
  type HistoryData,
  type HistoryGame,
} from '../analyze/history';
import type { SleeperBracketMatchup } from '../types';

const g = (season: string, week: number, a: string, b: string, pa: number, pb: number, kind: HistoryGame['kind'] = 'regular'): HistoryGame =>
  ({ season, week, a, b, pa, pb, kind });

function data(): HistoryData {
  return {
    managers: ['u1', 'u2', 'u3', 'u4'].map((id) => ({ userId: id, name: id, avatarUrl: null })),
    seasons: [
      {
        season: '2025', complete: true,
        teams: ['u1', 'u2', 'u3', 'u4'].map((u, i) => ({ userId: u, rosterId: i + 1, teamName: u, avatarUrl: null })),
        champion: 'u1', runnerUp: 'u2', toiletLoser: 'u4', playoffTeams: ['u1', 'u2'], placements: { u1: 1, u2: 2 },
      },
      {
        season: '2024', complete: true,
        teams: ['u1', 'u2', 'u3'].map((u, i) => ({ userId: u, rosterId: i + 1, teamName: u, avatarUrl: null })),
        champion: 'u2', runnerUp: 'u1', toiletLoser: 'u3', playoffTeams: ['u1', 'u2'], placements: { u2: 1, u1: 2 },
      },
    ],
    games: [
      g('2024', 1, 'u1', 'u2', 100, 90),
      g('2024', 2, 'u1', 'u3', 80, 120),
      g('2024', 3, 'u2', 'u3', 150, 60),
      g('2025', 1, 'u1', 'u2', 110, 109.5),
      g('2025', 2, 'u3', 'u4', 95, 95),
      g('2025', 3, 'u1', 'u4', 140, 70),
      g('2025', 15, 'u1', 'u2', 130, 120, 'playoff'),
      // Toilet bowl and placement games don't count for records
      g('2025', 15, 'u3', 'u4', 40, 200, 'toilet'),
      g('2025', 16, 'u3', 'u4', 3, 12.7, 'placement'),
    ],
    generatedAt: '',
  };
}

describe('brackets', () => {
  const winners: SleeperBracketMatchup[] = [
    { r: 1, m: 1, t1: 4, t2: 5, w: 4, l: 5 },
    { r: 2, m: 2, t1: 1, t2: 4, w: 1, l: 4 },
    { r: 2, m: 3, t1: 2, t2: 3, w: 2, l: 3 },
    { r: 3, m: 4, t1: 1, t2: 2, w: 2, l: 1, p: 1 },
    { r: 3, m: 5, t1: 4, t2: 3, w: 3, l: 4, p: 3 },
  ];
  const losers: SleeperBracketMatchup[] = [
    { r: 1, m: 1, t1: 8, t2: 9, w: 9, l: 8 },
    { r: 2, m: 2, t1: 9, t2: 10, w: 10, l: 9, p: 1 },
    // Escaped the toilet bowl, playing for a place
    { r: 2, m: 3, t1: 8, t2: 7, w: 7, l: 8, p: 3 },
  ];

  it('reads the champion, runner-up and toilet bowl loser (who "won" the losers bracket final)', () => {
    const r = bracketResults(winners, losers);
    expect(r.champion).toBe(2);
    expect(r.runnerUp).toBe(1);
    expect(r.toiletLoser).toBe(10);
    expect(r.playoffTeams.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(r.placements).toMatchObject({ 2: 1, 1: 2, 3: 3, 4: 4 });
  });

  it('classifies postseason games by bracket', () => {
    expect(postseasonKind(3, [1, 2], winners, losers)).toBe('playoff');
    expect(postseasonKind(3, [3, 4], winners, losers)).toBe('placement');
    expect(postseasonKind(2, [10, 9], winners, losers)).toBe('toilet');
    // A placement game counts as one in either bracket
    expect(postseasonKind(2, [8, 7], winners, losers)).toBe('placement');
    expect(postseasonKind(1, [6, 7], winners, losers)).toBe('consolation');
  });
});

describe('allTimeStandings', () => {
  it('adds up regular seasons, playoff and toilet bowl games and postseason results by manager', () => {
    const rows = allTimeStandings(data());
    const u1 = rows.find((r) => r.userId === 'u1')!;
    // 3-1 in the regular season plus a playoff win
    expect(u1).toMatchObject({ seasons: 2, wins: 4, losses: 1, ties: 0, playoffs: 2, finals: 2, titles: 1, bestFinish: 1 });
    expect(u1.pointsPerGame).toBeCloseTo((100 + 80 + 110 + 140 + 130) / 5);
    const u3 = rows.find((r) => r.userId === 'u3')!;
    // The toilet bowl loss counts; the placement game never does
    expect(u3).toMatchObject({ wins: 1, losses: 2, ties: 1, toiletLosses: 1, bestFinish: null });
    // A tie counts as half a win
    expect(u3.winPct).toBeCloseTo(1.5 / 4);
    // Titles first
    expect(rows.slice(0, 2).map((r) => r.titles)).toEqual([1, 1]);
  });

  it('can count the regular season only', () => {
    const rows = allTimeStandings(data(), { postseason: false });
    const u1 = rows.find((r) => r.userId === 'u1')!;
    expect(u1).toMatchObject({ wins: 3, losses: 1, titles: 1 });
    expect(u1.pointsPerGame).toBeCloseTo((100 + 80 + 110 + 140) / 4);
    expect(rows.find((r) => r.userId === 'u3')).toMatchObject({ wins: 1, losses: 1, ties: 1 });
  });
});

describe('headToHead and rivalries', () => {
  it('counts regular season, playoff and toilet bowl games from both sides', () => {
    const h = headToHead(data());
    expect(h.u1.u2).toMatchObject({ wins: 3, losses: 0 });
    expect(h.u2.u1).toMatchObject({ wins: 0, losses: 3 });
    expect(h.u1.u2.games).toHaveLength(3);
    // The toilet bowl game counts; the placement game doesn't
    expect(h.u3.u4).toMatchObject({ wins: 0, losses: 1, ties: 1 });
    expect(h.u4.u3).toMatchObject({ wins: 1, losses: 0, ties: 1 });
  });

  it('can count the regular season only', () => {
    const h = headToHead(data(), { postseason: false });
    expect(h.u1.u2).toMatchObject({ wins: 2, losses: 0 });
    expect(h.u3.u4).toMatchObject({ wins: 0, losses: 0, ties: 1 });
    expect(rivalries(data(), { postseason: false }).find((x) => [x.a, x.b].sort().join() === 'u1,u2')).toMatchObject({ games: 2 });
  });

  it('lists each pair once, led by whoever leads the series', () => {
    const r = rivalries(data());
    const pair = r.find((x) => [x.a, x.b].sort().join() === 'u1,u2')!;
    expect(pair).toMatchObject({ a: 'u1', b: 'u2', games: 3, wins: 3, losses: 0 });
    expect(r.filter((x) => [x.a, x.b].sort().join() === 'u1,u2')).toHaveLength(1);
  });
});

describe('recordBook', () => {
  it('finds game and season records, leaving out the toilet bowl', () => {
    const r = recordBook(data(), 3);
    expect(r.highestScores[0]).toMatchObject({ userId: 'u2', value: 150 });
    expect(r.lowestScores[0]).toMatchObject({ userId: 'u3', value: 60 });
    expect(r.biggestBlowouts[0]).toMatchObject({ userId: 'u2', value: 90 });
    // Ties aren't close games
    expect(r.closestGames[0]).toMatchObject({ userId: 'u1', value: 0.5 });
    expect(r.mostPointsInLoss[0]).toMatchObject({ userId: 'u2', value: 120 });
    expect(r.fewestPointsInWin[0]).toMatchObject({ userId: 'u1', value: 100 });
    expect(r.bestSeasons[0]).toMatchObject({ userId: 'u1', season: '2025', wins: 2, losses: 0 });
    expect([...r.highestScores, ...r.lowestScores, ...r.fewestPointsInWin].some((x) => x.game.kind === 'toilet' || x.game.kind === 'placement')).toBe(false);
  });
});

describe('seasons before Sleeper', () => {
  const withLegacy = (): HistoryData => {
    const d = data();
    d.managers.push({ userId: 'legacy:vikram', name: 'Vikram', avatarUrl: null });
    d.seasons.push({
      season: '2017',
      complete: true,
      legacy: true,
      teams: ['u3', 'legacy:vikram', 'u1'].map((u) => ({ userId: u, rosterId: 0, teamName: u, avatarUrl: null })),
      standings: [
        { userId: 'u3', wins: 12, losses: 2, rank: 1 },
        { userId: 'legacy:vikram', wins: 8, losses: 6, rank: 2 },
        { userId: 'u1', wins: 1, losses: 13, rank: 3 },
      ],
      champion: 'u3',
      runnerUp: 'legacy:vikram',
      thirdPlace: 'u1',
      toiletLoser: null,
      playoffTeams: [],
      placements: { u3: 1, 'legacy:vikram': 2, u1: 3 },
    });
    return d;
  };

  it('count toward records, titles and finishes but not points', () => {
    const rows = allTimeStandings(withLegacy());
    const u3 = rows.find((r) => r.userId === 'u3')!;
    // 12-2 before Sleeper, plus 1-2-1 since (the toilet bowl loss included)
    expect(u3).toMatchObject({ wins: 13, losses: 4, ties: 1, titles: 1, finals: 1, bestFinish: 1 });
    // Points per game only from scored (Sleeper) games
    expect(u3.scoredGames).toBe(4);
    expect(u3.pointsPerGame).toBeCloseTo((120 + 60 + 95 + 40) / 4);
    const vikram = rows.find((r) => r.userId === 'legacy:vikram')!;
    expect(vikram).toMatchObject({ seasons: 1, wins: 8, losses: 6, scoredGames: 0, pointsPerGame: 0, finals: 1 });
  });

  it('show up in season records without points', () => {
    const r = recordBook(withLegacy(), 3);
    // (the test league's 2-0 season tops a 12-2 one on win %)
    expect(r.bestSeasons).toContainEqual({ season: '2017', userId: 'u3', wins: 12, losses: 2, ties: 0, pointsPerGame: null });
    expect(r.worstSeasons).toContainEqual({ season: '2017', userId: 'u1', wins: 1, losses: 13, ties: 0, pointsPerGame: null });
    expect(r.mostPointsSeasons.every((x) => x.pointsPerGame !== null)).toBe(true);
  });
});
