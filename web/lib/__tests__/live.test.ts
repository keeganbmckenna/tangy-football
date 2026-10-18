import { describe, it, expect } from 'vitest';
import {
  liveWeekNumber,
  liveMatchupStatus,
  livePlayAll,
  liveStandings,
  liveTeamStats,
  liveWinOdds,
  liveLineup,
  leaguePoints,
  withLivePoints,
  gameRemaining,
  injuryAdjusted,
  playerSpreadRatio,
  POSITION_SPREAD_RATIO,
  type LiveGame,
  type LiveProjection,
  type LiveWeekData,
} from '../analyze/live';
import { rankTeams } from '../analyze/teamStats';
import type { LeagueData, SleeperMatchup, SleeperRoster, SleeperUser, TeamStats } from '../types';

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

describe('matchups level at 0', () => {
  // Thursday night: only teams 1 and 3 have points; 2 and 4 are both still at 0
  const live = liveWeek([m(1, 1, 10), m(2, 1, 0), m(3, 2, 0), m(4, 2, 0)]);

  it('are ties in the real matchup and the standings', () => {
    expect(liveMatchupStatus(live.matchups).get(3)?.result).toBe('T');
    const { rows } = liveStandings(liveTeamStats(league(), live), 2, 2, true);
    const team3 = rows.find((r) => r.team.rosterId === 3)!;
    expect(team3.liveResult).toBe('T');
    expect(team3.now).toMatchObject({ wins: 0, losses: 1, ties: 1 });
    // Team 1 is ahead 10-0, which does count
    expect(rows.find((r) => r.team.rosterId === 1)?.now.wins).toBe(2);
  });

  it('are ties in play-all, which is the record at the current scores', () => {
    const rows = livePlayAll(liveTeamStats(league(), live), 2);
    const team3 = rows.find((r) => r.team.rosterId === 3)!;
    // Lost to team 1 (10 > 0); level at 0 with teams 2 and 4
    expect(team3.week).toMatchObject({ wins: 0, losses: 1, ties: 2 });
    expect(team3.week.winPct).toBeCloseTo(1 / 3);
    // The real matchup is level at 0 with team 4
    expect(team3.week.actualResult).toBe('T');
    // Season play-all includes this week's ties
    expect(team3.seasonTies).toBe(2);
  });

  it('rank a tie as half a win, ahead of points for', () => {
    const team = (rosterId: number, wins: number, ties: number, totalPoints: number) =>
      ({ rosterId, wins, losses: 2 - wins - ties, ties, totalPoints }) as TeamStats;
    const ranked = rankTeams([team(1, 1, 0, 500), team(2, 1, 1, 100), team(3, 0, 1, 900)]);
    expect(ranked.map((t) => t.rosterId)).toEqual([2, 1, 3]);
  });

  it('counts genuine non-zero ties too', () => {
    const tied = liveWeek([m(1, 1, 50), m(2, 1, 50), m(3, 2, 40), m(4, 2, 60)]);
    const rows = livePlayAll(liveTeamStats(league(), tied), 2);
    const team1 = rows.find((r) => r.team.rosterId === 1)!;
    expect(team1.week).toMatchObject({ wins: 1, losses: 1, ties: 1, actualResult: 'T' });
    expect(liveMatchupStatus(tied.matchups).get(1)?.result).toBe('T');
  });
});

describe('liveStandings', () => {
  it('applies the live result as if the week ended now', () => {
    const live = liveWeek([m(1, 1, 40), m(2, 1, 70), m(3, 2, 60), m(4, 2, 80)]);
    const { rows, divisions, wildCard } = liveStandings(liveTeamStats(league(), live), 2, 2, true);
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
    // Division and wild card picture as if the week ended now
    expect(divisions.map((d) => d.leader.rosterId)).toEqual([1, 2]);
    // 2 playoff spots, both taken by division leaders: no wild cards
    expect(wildCard).toEqual([]);
  });

  it('does not change the teams it was given', () => {
    const live = liveWeek([m(1, 1, 40), m(2, 1, 70), m(3, 2, 60), m(4, 2, 80)]);
    const teams = liveTeamStats(league(), live);
    const before = teams.map((t) => ({ id: t.rosterId, wins: t.wins, standing: t.standing }));
    liveStandings(teams, 2, 2, true);
    expect(teams.map((t) => ({ id: t.rosterId, wins: t.wins, standing: t.standing }))).toEqual(before);
  });

  it('builds the wild card race like the Overview tab', () => {
    const live = liveWeek([m(1, 1, 40), m(2, 1, 70), m(3, 2, 60), m(4, 2, 80)]);
    const { wildCard, rows } = liveStandings(liveTeamStats(league(), live), 2, 3, true);
    // 3 spots: 2 division leaders + 1 wild card; team 4 (1-1) beats team 3 (0-2)
    expect(wildCard.map((w) => [w.team.rosterId, w.isIn])).toEqual([[4, true], [3, false]]);
    expect(rows.find((r) => r.team.rosterId === 4)?.now.status).toBe('wildcard');
  });

  it('uses overall rank for playoff spots without divisions', () => {
    const live = liveWeek([m(1, 1, 40), m(2, 1, 70), m(3, 2, 60), m(4, 2, 80)]);
    const { rows, divisions } = liveStandings(liveTeamStats(league(), live), 2, 2, false);
    // 2 is 2-0; 4 and 1 are both 1-1, and 4 has more points (170 vs 160)
    expect(rows.filter((r) => r.now.status === 'in').map((r) => r.team.rosterId)).toEqual([2, 4]);
    expect(divisions).toEqual([]);
  });
});

describe('live win odds', () => {
  it('counts the time left in a game, with overtime likelier when it is close late', () => {
    expect(gameRemaining('post', 4, 0, 0)).toBe(0);
    // Before kickoff: the whole game plus a small chance of overtime (about 1 in 18)
    const pre = gameRemaining('pre', 0, 0, 0);
    expect(pre).toBeGreaterThan(1);
    expect((pre - 1) / (6.46 / 60)).toBeCloseTo(0.056, 2);
    // Halftime of a blowout: half a game, no overtime to speak of
    expect(gameRemaining('in', 2, 0, 28)).toBeCloseTo(0.5, 3);
    // Tied with two minutes left: overtime is a real chance
    const tied = gameRemaining('in', 4, 120, 0);
    expect(tied - 120 / 3600).toBeGreaterThan(0.25 * (6.46 / 60));
    expect(gameRemaining('in', 4, 120, 14) - 120 / 3600).toBeLessThan(0.001);
    // In overtime: most end before the 10 minutes run out, so less than the clock shows
    expect(gameRemaining('in', 5, 600, 0)).toBeCloseTo(6.46 / 60);
    expect(gameRemaining('in', 5, 300, 0)).toBeCloseTo(2.55 / 60);
    expect(gameRemaining('in', 5, 30, 0)).toBeLessThanOrEqual(0.5 / 60);
  });

  it('drops players ruled out and discounts doubtful ones before kickoff', () => {
    expect(injuryAdjusted(15, 'Out', false)).toBe(0);
    expect(injuryAdjusted(15, 'IR', true)).toBe(0);
    expect(injuryAdjusted(15, 'Doubtful', false)).toBeCloseTo(4.5);
    expect(injuryAdjusted(15, 'Doubtful', true)).toBe(15);
    expect(injuryAdjusted(15, 'Questionable', false)).toBe(15);
    expect(injuryAdjusted(15, null, false)).toBe(15);
  });

  it("blends a player's own boom-or-bust spread with his position's", () => {
    expect(playerSpreadRatio('WR', [])).toBe(POSITION_SPREAD_RATIO.WR);
    const steady = playerSpreadRatio('WR', [15, 16, 14, 15, 16, 14]);
    const boomBust = playerSpreadRatio('WR', [2, 30, 3, 28, 1, 26]);
    expect(steady).toBeLessThan(POSITION_SPREAD_RATIO.WR);
    expect(boomBust).toBeGreaterThan(POSITION_SPREAD_RATIO.WR);
  });

  const proj = (points: number, team: string, spreadRatio = 0.6): LiveProjection => ({ points, team, spreadRatio, name: 'P', position: 'WR', injury: null });
  const sm = (roster_id: number, points: number, starters: string[]): SleeperMatchup => ({ roster_id, matchup_id: 1, points, starters });

  it('favors the team ahead and settles as games finish', () => {
    const projections = { a1: proj(20, 'AAA'), b1: proj(20, 'BBB') };
    const matchups = [sm(1, 60, ['a1']), sm(2, 50, ['b1'])];
    const pre: Record<string, LiveGame> = { AAA: { state: 'pre', remaining: 1, label: '' }, BBB: { state: 'pre', remaining: 1, label: '' } };
    const before = liveWinOdds(matchups, projections, pre, 25)[0];
    expect(before.aWinOdds).toBeGreaterThan(0.5);
    expect(before.aWinOdds).toBeLessThan(0.9);
    expect(before.a).toMatchObject({ projected: 80, toPlay: 1, playing: 0 });
    const done: Record<string, LiveGame> = { AAA: { state: 'post', remaining: 0, label: '' }, BBB: { state: 'post', remaining: 0, label: '' } };
    expect(liveWinOdds(matchups, projections, done, 25)[0].aWinOdds).toBe(1);
  });

  it('gives a volatile lineup a better chance to come back than a steady one', () => {
    const games: Record<string, LiveGame> = { AAA: { state: 'pre', remaining: 1, label: '' }, BBB: { state: 'pre', remaining: 1, label: '' } };
    // The rest of the league (which sets the scale) stays the same; only team 1's volatility changes
    const others = [3, 4, 5, 6, 7, 8].map((id) => ({ ...sm(id, 0, [`p${id}`]), matchup_id: 2 + Math.floor((id - 3) / 2) }));
    const otherProj = Object.fromEntries(others.map((o) => [`p${o.roster_id}`, proj(20, 'AAA')]));
    const odds = (ratio: number) =>
      liveWinOdds([sm(1, 0, ['a1']), sm(2, 20, ['b1']), ...others], { ...otherProj, a1: proj(20, 'AAA', ratio), b1: proj(20, 'BBB', 0.3) }, games, 25)[0].aWinOdds;
    expect(odds(1.2)).toBeGreaterThan(odds(0.3));
  });

  it("lists each starter's points so far and projected final", () => {
    const m: SleeperMatchup = { roster_id: 1, matchup_id: 1, points: 12, starters: ['a1', '0', 'b1'], players_points: { a1: 10, b1: 2 } };
    const games: Record<string, LiveGame> = { AAA: { state: 'in', remaining: 0.5, label: 'Q3 15:00' }, BBB: { state: 'post', remaining: 0, label: 'Final' } };
    const rows = liveLineup(m, { a1: proj(20, 'AAA'), b1: proj(8, 'BBB') }, games);
    expect(rows[1]).toBeNull();
    expect(rows[0]).toMatchObject({ points: 10, projected: 20, game: { label: 'Q3 15:00' } });
    expect(rows[2]).toMatchObject({ points: 2, projected: 2 });
  });

  it("scores live stats with the league's settings, and totals each team's starters", () => {
    const scoring = { pass_yd: 0.04, pass_td: 4, rec: 0.5, rec_yd: 0.1, fum_lost: -2 };
    expect(leaguePoints({ pass_yd: 250, pass_td: 2, gp: 1 }, scoring)).toBe(18);
    const m: SleeperMatchup = { roster_id: 1, matchup_id: 1, points: 5, starters: ['a', 'b'], players: ['a', 'b', 'c'], players_points: { a: 5, b: 0, c: 0 } };
    const [out] = withLivePoints([m], { a: { rec: 6, rec_yd: 81, fum_lost: 1 }, c: { rec: 2, rec_yd: 20 } }, scoring);
    // a: 3 + 8.1 - 2; b has no stats yet and keeps Sleeper's 0; c is on the bench
    expect(out.players_points).toEqual({ a: 9.1, b: 0, c: 3 });
    expect(out.points).toBe(9.1);
  });
});
