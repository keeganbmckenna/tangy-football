import { describe, it, expect } from 'vitest';
import {
  getAvatarUrl,
  getCustomTeamName,
  getTeamName,
  calculateTeamStats,
  calculateWeeklyMedians,
  calculateDivisionStandings,
} from '../analyze';
import type {
  SleeperUser,
  LeagueData,
  SleeperRoster,
  SleeperMatchup,
  SleeperLeague,
} from '../types';

// Mock data helpers
function createMockUser(overrides?: Partial<SleeperUser>): SleeperUser {
  return {
    user_id: 'user1',
    username: 'testuser',
    display_name: 'Test User',
    avatar: 'avatar123',
    ...overrides,
  };
}

function createMockRoster(overrides?: Partial<SleeperRoster>): SleeperRoster {
  return {
    roster_id: 1,
    owner_id: 'user1',
    players: [],
    settings: {
      wins: 0,
      losses: 0,
      ties: 0,
      fpts: 0,
      ...overrides?.settings,
    },
    ...overrides,
  };
}

function createMockLeagueData(overrides?: Partial<LeagueData>): LeagueData {
  const defaultData: LeagueData = {
    league: {
      league_id: 'league1',
      name: 'Test League',
      season: '2024',
      status: 'in_season',
    } as SleeperLeague,
    rosters: [],
    users: [],
    matchups: {},
    userMap: {},
    rosterToUserMap: {},
    lastScoredWeek: 0,
    availableSeasons: ['2024'],
    ...overrides,
  };
  return defaultData;
}

describe('getAvatarUrl', () => {
  it('should return null for undefined user', () => {
    expect(getAvatarUrl(undefined)).toBeNull();
  });

  it('should prioritize metadata.avatar over avatar ID', () => {
    const user = createMockUser({
      avatar: 'avatar123',
      metadata: { avatar: 'https://example.com/custom-avatar.png' },
    });
    expect(getAvatarUrl(user)).toBe('https://example.com/custom-avatar.png');
  });

  it('should use avatar ID when metadata.avatar is not available', () => {
    const user = createMockUser({ avatar: 'avatar123' });
    expect(getAvatarUrl(user)).toBe('https://sleepercdn.com/avatars/thumbs/avatar123');
  });

  it('should return null when no avatar is available', () => {
    const user = createMockUser({ avatar: undefined });
    expect(getAvatarUrl(user)).toBeNull();
  });
});

describe('getCustomTeamName', () => {
  it('should return fallback for undefined user', () => {
    expect(getCustomTeamName(undefined, 'Team 1')).toBe('Team 1');
  });

  it('should prioritize metadata.team_name', () => {
    const user = createMockUser({
      display_name: 'Test User',
      metadata: { team_name: 'Custom Team Name' },
    });
    expect(getCustomTeamName(user, 'Team 1')).toBe('Custom Team Name');
  });

  it('should fall back to display_name when team_name is not available', () => {
    const user = createMockUser({ display_name: 'Test User' });
    expect(getCustomTeamName(user, 'Team 1')).toBe('Test User');
  });

  it('should use fallback when no custom name or display name', () => {
    const user = createMockUser({ display_name: '' });
    expect(getCustomTeamName(user, 'Team 1')).toBe('Team 1');
  });
});

describe('getTeamName', () => {
  it('should return team name and username from user map', () => {
    const user = createMockUser({ display_name: 'John Doe' });
    const data = createMockLeagueData({
      rosterToUserMap: { 1: 'user1' },
      userMap: { user1: user },
    });

    const result = getTeamName(1, data);
    expect(result).toEqual({ name: 'John Doe', username: 'testuser' });
  });

  it('should return default team name when user not found', () => {
    const data = createMockLeagueData({
      rosterToUserMap: {},
      userMap: {},
    });

    const result = getTeamName(1, data);
    expect(result).toEqual({ name: 'Team 1', username: 'Team 1' });
  });

  it('should return default when roster ID not mapped', () => {
    const data = createMockLeagueData({
      rosterToUserMap: { 2: 'user1' },
      userMap: {},
    });

    const result = getTeamName(1, data);
    expect(result).toEqual({ name: 'Team 1', username: 'Team 1' });
  });
});

describe('calculateTeamStats', () => {
  it('should calculate basic stats for teams with no matchups', () => {
    const roster1 = createMockRoster({
      roster_id: 1,
      owner_id: 'user1',
      settings: { wins: 5, losses: 3, ties: 0, fpts: 1200 },
    });

    const user1 = createMockUser({ user_id: 'user1', display_name: 'Team 1' });

    const data = createMockLeagueData({
      rosters: [roster1],
      users: [user1],
      userMap: { user1: user1 },
      rosterToUserMap: { 1: 'user1' },
      matchups: {},
    });

    const stats = calculateTeamStats(data);

    expect(stats).toHaveLength(1);
    expect(stats[0].teamName).toBe('Team 1');
    expect(stats[0].wins).toBe(5);
    expect(stats[0].losses).toBe(3);
    expect(stats[0].totalPoints).toBe(1200);
    expect(stats[0].standing).toBe(1);
  });

  it('should calculate stats with matchup data', () => {
    const roster1 = createMockRoster({
      roster_id: 1,
      owner_id: 'user1',
      settings: { wins: 1, losses: 0, ties: 0, fpts: 150 },
    });
    const roster2 = createMockRoster({
      roster_id: 2,
      owner_id: 'user2',
      settings: { wins: 0, losses: 1, ties: 0, fpts: 100 },
    });

    const user1 = createMockUser({ user_id: 'user1', display_name: 'Team 1' });
    const user2 = createMockUser({ user_id: 'user2', display_name: 'Team 2' });

    const matchup1: SleeperMatchup = { roster_id: 1, matchup_id: 1, points: 150 };
    const matchup2: SleeperMatchup = { roster_id: 2, matchup_id: 1, points: 100 };

    const data = createMockLeagueData({
      rosters: [roster1, roster2],
      users: [user1, user2],
      userMap: { user1: user1, user2: user2 },
      rosterToUserMap: { 1: 'user1', 2: 'user2' },
      matchups: { 1: [matchup1, matchup2] },
    });

    const stats = calculateTeamStats(data);

    expect(stats).toHaveLength(2);
    expect(stats[0].weeklyScores[0]).toBe(150);
    expect(stats[1].weeklyScores[0]).toBe(100);
  });

  it('should sort teams by standings (wins, then points)', () => {
    const roster1 = createMockRoster({
      roster_id: 1,
      settings: { wins: 5, losses: 3, ties: 0, fpts: 1200 },
    });
    const roster2 = createMockRoster({
      roster_id: 2,
      owner_id: 'user2',
      settings: { wins: 6, losses: 2, ties: 0, fpts: 1100 },
    });
    const roster3 = createMockRoster({
      roster_id: 3,
      owner_id: 'user3',
      settings: { wins: 5, losses: 3, ties: 0, fpts: 1250 },
    });

    const data = createMockLeagueData({
      rosters: [roster1, roster2, roster3],
      users: [
        createMockUser({ user_id: 'user1', display_name: 'Team 1' }),
        createMockUser({ user_id: 'user2', display_name: 'Team 2' }),
        createMockUser({ user_id: 'user3', display_name: 'Team 3' }),
      ],
      userMap: {
        user1: createMockUser({ user_id: 'user1', display_name: 'Team 1' }),
        user2: createMockUser({ user_id: 'user2', display_name: 'Team 2' }),
        user3: createMockUser({ user_id: 'user3', display_name: 'Team 3' }),
      },
      rosterToUserMap: { 1: 'user1', 2: 'user2', 3: 'user3' },
    });

    const stats = calculateTeamStats(data);

    expect(stats[0].wins).toBe(6);
    expect(stats[0].standing).toBe(1);
    expect(stats[1].wins).toBe(5);
    expect(stats[1].totalPoints).toBe(1250);
    expect(stats[1].standing).toBe(2);
    expect(stats[2].wins).toBe(5);
    expect(stats[2].totalPoints).toBe(1200);
    expect(stats[2].standing).toBe(3);
  });

  it('should average points over scored weeks only, ignoring the current unscored week', () => {
    const roster1 = createMockRoster({
      roster_id: 1,
      owner_id: 'user1',
      settings: { wins: 2, losses: 0, ties: 0, fpts: 300 },
    });
    const roster2 = createMockRoster({
      roster_id: 2,
      owner_id: 'user2',
      settings: { wins: 0, losses: 2, ties: 0, fpts: 200 },
    });

    const user1 = createMockUser({ user_id: 'user1', display_name: 'Team 1' });
    const user2 = createMockUser({ user_id: 'user2', display_name: 'Team 2' });

    const data = createMockLeagueData({
      rosters: [roster1, roster2],
      users: [user1, user2],
      userMap: { user1: user1, user2: user2 },
      rosterToUserMap: { 1: 'user1', 2: 'user2' },
      // Two scored weeks plus the current unscored week (points 0)
      matchups: {
        1: [
          { roster_id: 1, matchup_id: 1, points: 150 },
          { roster_id: 2, matchup_id: 1, points: 100 },
        ],
        2: [
          { roster_id: 1, matchup_id: 1, points: 150 },
          { roster_id: 2, matchup_id: 1, points: 100 },
        ],
        3: [
          { roster_id: 1, matchup_id: 1, points: 0 },
          { roster_id: 2, matchup_id: 1, points: 0 },
        ],
      },
    });

    const stats = calculateTeamStats(data, 2);

    expect(stats[0].weeklyScores).toHaveLength(3);
    expect(stats[0].avgPoints).toBe(150);
    expect(stats[1].avgPoints).toBe(100);
  });
});

describe('calculateWeeklyMedians', () => {
  it('should calculate median for each week', () => {
    const roster1 = createMockRoster({ roster_id: 1, owner_id: 'user1' });
    const roster2 = createMockRoster({ roster_id: 2, owner_id: 'user2' });
    const roster3 = createMockRoster({ roster_id: 3, owner_id: 'user3' });

    const matchup1w1: SleeperMatchup = { roster_id: 1, matchup_id: 1, points: 100 };
    const matchup2w1: SleeperMatchup = { roster_id: 2, matchup_id: 1, points: 120 };
    const matchup3w1: SleeperMatchup = { roster_id: 3, matchup_id: 2, points: 110 };

    const data = createMockLeagueData({
      rosters: [roster1, roster2, roster3],
      users: [
        createMockUser({ user_id: 'user1', display_name: 'Team 1' }),
        createMockUser({ user_id: 'user2', display_name: 'Team 2' }),
        createMockUser({ user_id: 'user3', display_name: 'Team 3' }),
      ],
      userMap: {
        user1: createMockUser({ user_id: 'user1', display_name: 'Team 1' }),
        user2: createMockUser({ user_id: 'user2', display_name: 'Team 2' }),
        user3: createMockUser({ user_id: 'user3', display_name: 'Team 3' }),
      },
      rosterToUserMap: { 1: 'user1', 2: 'user2', 3: 'user3' },
      matchups: { 1: [matchup1w1, matchup2w1, matchup3w1] },
    });

    const stats = calculateTeamStats(data);
    const medians = calculateWeeklyMedians(stats, 1);

    expect(medians).toHaveLength(1);
    expect(medians[0]).toBeGreaterThan(0);
  });
});

describe('calculateDivisionStandings', () => {
  it('should calculate division standings', () => {
    const roster1 = createMockRoster({
      roster_id: 1,
      settings: { wins: 5, losses: 3, ties: 0, fpts: 1200, division: 1 },
    });
    const roster2 = createMockRoster({
      roster_id: 2,
      owner_id: 'user2',
      settings: { wins: 4, losses: 4, ties: 0, fpts: 1100, division: 1 },
    });
    const roster3 = createMockRoster({
      roster_id: 3,
      owner_id: 'user3',
      settings: { wins: 6, losses: 2, ties: 0, fpts: 1300, division: 2 },
    });

    const data = createMockLeagueData({
      league: {
        league_id: 'league1',
        name: 'Test League',
        season: '2024',
        status: 'in_season',
        metadata: { division_1: 'East', division_2: 'West' },
      } as SleeperLeague,
      rosters: [roster1, roster2, roster3],
      users: [
        createMockUser({ user_id: 'user1', display_name: 'Team 1' }),
        createMockUser({ user_id: 'user2', display_name: 'Team 2' }),
        createMockUser({ user_id: 'user3', display_name: 'Team 3' }),
      ],
      userMap: {
        user1: createMockUser({ user_id: 'user1', display_name: 'Team 1' }),
        user2: createMockUser({ user_id: 'user2', display_name: 'Team 2' }),
        user3: createMockUser({ user_id: 'user3', display_name: 'Team 3' }),
      },
      rosterToUserMap: { 1: 'user1', 2: 'user2', 3: 'user3' },
    });

    const stats = calculateTeamStats(data);
    const divisions = calculateDivisionStandings(stats);

    expect(divisions).toHaveLength(2);
    expect(divisions[0].divisionName).toContain('Division');
    expect(divisions[0].teams).toHaveLength(2);
    expect(divisions[1].teams).toHaveLength(1);
  });
});
