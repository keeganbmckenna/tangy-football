import { describe, expect, it } from 'vitest';
import { managerProfile } from '../analyze/managerProfile';
import type { HistoryData, HistoryGame } from '../analyze/history';

const g = (season: string, week: number, a: string, b: string, pa: number, pb: number, kind: HistoryGame['kind'] = 'regular'): HistoryGame => ({ season, week, a, b, pa, pb, kind });

const data: HistoryData = {
  managers: ['u1', 'u2', 'u3'].map((id) => ({ userId: id, name: id, avatarUrl: null })),
  seasons: [
    {
      season: '2025', complete: true,
      teams: ['u1', 'u2', 'u3'].map((u, i) => ({ userId: u, rosterId: i + 1, teamName: `${u} 2025`, avatarUrl: null })),
      champion: 'u1', runnerUp: 'u2', toiletLoser: 'u3', playoffTeams: ['u1', 'u2'], placements: { u1: 1, u2: 2 },
    },
    {
      season: '2024', complete: true,
      teams: ['u1', 'u2', 'u3'].map((u, i) => ({ userId: u, rosterId: i + 1, teamName: `${u} 2024`, avatarUrl: null })),
      champion: 'u2', runnerUp: 'u3', toiletLoser: 'u1', playoffTeams: ['u2', 'u3'], placements: { u2: 1, u3: 2 },
    },
    {
      season: '2020', complete: true, legacy: true,
      standings: [{ userId: 'u1', wins: 9, losses: 4, rank: 2 }],
      teams: [{ userId: 'u1', rosterId: 0, teamName: 'old team', avatarUrl: null }],
      champion: null, runnerUp: null, toiletLoser: null, playoffTeams: [], placements: {},
    },
  ],
  games: [
    g('2024', 1, 'u1', 'u2', 90, 100),
    g('2024', 2, 'u1', 'u3', 80, 120),
    g('2024', 3, 'u2', 'u3', 150, 60),
    g('2025', 1, 'u1', 'u2', 110, 109.5),
    g('2025', 2, 'u1', 'u3', 140, 70),
    g('2025', 3, 'u2', 'u3', 100, 90),
    g('2025', 15, 'u1', 'u2', 130, 120, 'playoff'),
    g('2025', 15, 'u3', 'u1', 200, 40, 'placement'),
  ],
  generatedAt: '',
};

describe('managerProfile', () => {
  const p = managerProfile(data, 'u1', {}, 2)!;

  it('lists every season, newest first, with record, rank and finish', () => {
    expect(p.seasons.map((s) => s.season)).toEqual(['2025', '2024', '2020']);
    expect(p.seasons[0]).toMatchObject({ teamName: 'u1 2025', wins: 2, losses: 0, regularRank: 1, champion: true, placement: 1, playoffs: true });
    expect(p.seasons[0].pointsPerGame).toBeCloseTo(125);
    expect(p.seasons[1]).toMatchObject({ wins: 0, losses: 2, regularRank: 3, toiletLoser: true, playoffs: false });
    // Before Sleeper: the final standings, no points
    expect(p.seasons[2]).toMatchObject({ teamName: 'old team', wins: 9, losses: 4, regularRank: 2, pointsPerGame: null, legacy: true, playoffs: false });
  });

  it('records each opponent from its side, never placement games', () => {
    const vs2 = p.opponents.find((o) => o.userId === 'u2')!;
    expect(vs2).toMatchObject({ games: 3, wins: 2, losses: 1 });
    expect(vs2.margin).toBeCloseTo((110 + 130 + 90 - 109.5 - 120 - 100) / 3);
    expect(p.opponents.find((o) => o.userId === 'u3')).toMatchObject({ games: 2, wins: 1, losses: 1 });
    expect(p.favorite?.userId).toBe('u2');
    // 1-1 isn't a losing record: no nemesis
    expect(p.nemesis).toBeNull();
    expect(managerProfile(data, 'u3', {}, 2)!.nemesis?.userId).toBe('u2');
  });

  it('finds the best and worst games, and the playoff record', () => {
    expect(p.highest?.pf).toBe(140);
    expect(p.lowest?.pf).toBe(80);
    expect(p.biggestWin).toMatchObject({ pf: 140, pa: 70, opponent: 'u3' });
    expect(p.worstLoss).toMatchObject({ pf: 80, pa: 120 });
    expect(p.playoffRecord).toEqual({ wins: 1, losses: 0 });
  });

  it('ranks the career against the other managers', () => {
    expect(p.totals.titles).toBe(1);
    expect(p.ranks.of).toBe(3);
    expect(p.ranks.winPct).toBe(1);
  });

  it('has no page for someone not in the league', () => {
    expect(managerProfile(data, 'nobody')).toBeNull();
  });
});
