import { describe, it, expect } from 'vitest';
import {
  liveWeekNumber,
  liveMatchupStatus,
  livePlayAll,
  liveStandings,
  liveTeamStats,
  type LiveWeekData,
} from '../analyze/live';
import type { LeagueData, SleeperMatchup, SleeperRoster, SleeperUser } from '../types';

const m = (roster_id: number, matchup_id: number, points: number): SleeperMatchup => ({ roster_id, matchup_id, points });

function league(): LeagueData {
  // 4 teams, 2 divisions; week 1 already scored
  const rosters: SleeperRoster[] = [1, 2, 3, 4].map((id) => ({
    roster_id: id,
    owner_id: `u${id}`,
    players: [],
    settings: {
      wins: id <= 2 ? 1 : 0,
      losses: id <= 2 ? 0 : 1,
      ties: 0,
      fpts: [120, 110, 100, 90][id - 1],
      division: id % 2 === 1 ? 1 : 2,
    },
  })) as SleeperRoster[];
  const users = [1, 2, 3, 4].map((id) => ({ user_id: `u${id}`, username: `user${id}`, display_name: `Team ${id}` })) as SleeperUser[];
  return {
    league: { league_id: 'L', name: 'L', season: '2026', status: 'in_season' } as LeagueData['league'],
    rosters,
    users,
    matchups: {
      // Week 1: 1 beat 3, 2 beat 4
      1: [m(1, 1, 120), m(3, 1, 100), m(2, 2, 110), m(4, 2, 90)],
    },
    userMap: Object.fromEntries(users.map((u) => [u.user_id, u])),
    rosterToUserMap: Object.fromEntries(rosters.map((r) => [r.roster_id, r.owner_id])),
    lastScoredWeek: 1,
    availableSeasons: ['2026'],
  };
}

const liveWeek = (matchups: SleeperMatchup[]): LiveWeekData => ({
  season: '2026',
  week: 2,
  lastScoredWeek: 1,
  playoffWeekStart: 15,
  matchups,
  fetchedAt: '2026-10-11T18:00:00Z',
});

describe('liveWeekNumber', () => {
  it('is the current week once it is past the last scored week', () => {
    expect(liveWeekNumber(5, 4, 14)).toBe(5);
  });

  it('is null between scoring and the next week, and in the playoffs', () => {
    expect(liveWeekNumber(4, 4, 14)).toBeNull();
    expect(liveWeekNumber(15, 14, 14)).toBeNull();
    expect(liveWeekNumber(0, 0, 14)).toBeNull();
  });
});

describe('liveMatchupStatus', () => {
  it('reports who is currently ahead in each real matchup', () => {
    const s = liveMatchupStatus([m(1, 1, 50), m(2, 1, 40), m(3, 2, 30), m(4, 2, 30)]);
    expect(s.get(1)).toMatchObject({ result: 'W', opponentRosterId: 2, opponentScore: 40 });
    expect(s.get(2)?.result).toBe('L');
    expect(s.get(3)?.result).toBe('T');
  });
});

describe('livePlayAll', () => {
  it('records each team against all others at the current scores', () => {
    // Week 2 live: 4 leads 3 (80 vs 60), 1 trails 2 (40 vs 70)
    const live = liveWeek([m(1, 1, 40), m(2, 1, 70), m(3, 2, 60), m(4, 2, 80)]);
    const rows = livePlayAll(liveTeamStats(league(), live), 2);
    expect(rows.map((r) => r.team.rosterId)).toEqual([4, 2, 3, 1]);
    expect(rows[0].week).toMatchObject({ wins: 3, losses: 0, ties: 0, actualResult: 'W' });
    expect(rows[3].week).toMatchObject({ wins: 0, losses: 3, actualResult: 'L' });
    // Season play-all includes week 1: team 4 was last in week 1 (0-3)
    expect(rows[0]).toMatchObject({ seasonWins: 3, seasonLosses: 3 });
  });
});

describe('liveStandings', () => {
  it('applies the live result as if the week ended now', () => {
    const live = liveWeek([m(1, 1, 40), m(2, 1, 70), m(3, 2, 60), m(4, 2, 80)]);
    const rows = liveStandings(liveTeamStats(league(), live), 2, 2, true);
    const byId = new Map(rows.map((r) => [r.team.rosterId, r]));

    // Team 2 wins: 2-0 and first
    expect(byId.get(2)?.now).toMatchObject({ wins: 2, losses: 0, rank: 1 });
    expect(byId.get(2)?.before.rank).toBe(2);
    // Team 1 loses: 1-1, still leads division 1 over 0-2 team 3
    expect(byId.get(1)?.now).toMatchObject({ wins: 1, losses: 1, status: 'division' });
    // Team 4 wins: 1-1 but trails 2-0 team 2 in division 2
    expect(byId.get(4)?.now).toMatchObject({ wins: 1, losses: 1, status: 'out' });
    expect(byId.get(4)?.liveResult).toBe('W');
    // Points for include the live score
    expect(byId.get(2)?.team.totalPoints).toBe(180);
  });

  it('does not change the teams it was given', () => {
    const live = liveWeek([m(1, 1, 40), m(2, 1, 70), m(3, 2, 60), m(4, 2, 80)]);
    const teams = liveTeamStats(league(), live);
    const before = teams.map((t) => ({ id: t.rosterId, wins: t.wins, standing: t.standing }));
    liveStandings(teams, 2, 2, true);
    expect(teams.map((t) => ({ id: t.rosterId, wins: t.wins, standing: t.standing }))).toEqual(before);
  });

  it('uses overall rank for playoff spots without divisions', () => {
    const live = liveWeek([m(1, 1, 40), m(2, 1, 70), m(3, 2, 60), m(4, 2, 80)]);
    const rows = liveStandings(liveTeamStats(league(), live), 2, 2, false);
    // 2 is 2-0; 4 and 1 are both 1-1, and 4 has more points (170 vs 160)
    expect(rows.filter((r) => r.now.status === 'in').map((r) => r.team.rosterId)).toEqual([2, 4]);
  });
});
