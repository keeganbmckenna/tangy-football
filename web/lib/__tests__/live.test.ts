import { describe, it, expect } from 'vitest';
import {
  driveFor,
  gameMatchup,
  liveWeekNumber,
  currentWeek,
  liveMatchupStatus,
  livePlayAll,
  liveStandings,
  liveTeamStats,
  liveWinOdds,
  remainingPointsOdds,
  simulationWeight,
  type RemainingPlayer,
  liveLineup,
  leaguePoints,
  defenseExpected,
  allowedPoints,
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
import strengthModel from '../analyze/strengthModel.json';
import remainingOddsFixture from './fixtures/remainingOdds.json';
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

describe('currentWeek', () => {
  it('moves on to the next week once the current one is scored', () => {
    expect(currentWeek(7, 6)).toBe(7);
    expect(currentWeek(7, 7)).toBe(8);
    expect(currentWeek(1, 0)).toBe(1);
    expect(currentWeek(0, 0)).toBe(0);
  });
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

  it('drops players ruled out and doubtful ones, and discounts questionable ones, before kickoff', () => {
    expect(injuryAdjusted(15, 'Out', false)).toBe(0);
    expect(injuryAdjusted(15, 'IR', true)).toBe(0);
    expect(injuryAdjusted(15, 'Doubtful', false)).toBe(0);
    expect(injuryAdjusted(15, 'Doubtful', true)).toBe(15);
    expect(injuryAdjusted(15, 'Questionable', false)).toBeCloseTo(13.5);
    expect(injuryAdjusted(15, 'Questionable', true)).toBe(15);
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
    expect(rows[0]).toMatchObject({ points: 10, projected: 20, original: 20, game: { label: 'Q3 15:00' } });
    expect(rows[2]).toMatchObject({ points: 2, projected: 2, original: 8 });
  });

  it('keeps the projection of a player ruled out during his game, adding nothing more for him', () => {
    const m: SleeperMatchup = { roster_id: 1, matchup_id: 1, points: 2.7, starters: ['hurt'], players_points: { hurt: 2.7 } };
    const games: Record<string, LiveGame> = { AAA: { state: 'in', remaining: 0.5, label: 'Q2 3:00' } };
    // The route zeroes his points for the odds and keeps Sleeper's 11.3 to show
    const [row] = liveLineup(m, { hurt: { ...proj(0, 'AAA'), original: 11.3, injury: 'Out' } }, games);
    expect(row).toMatchObject({ points: 2.7, projected: 2.7, original: 11.3 });
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

  describe('defenses', () => {
    // This league's points-allowed brackets
    const scoring = { pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4 };
    const proj = { allowed: 22.75, other: 3.5 };

    it('scores points allowed by bracket', () => {
      expect(allowedPoints(0, scoring)).toBe(10);
      expect(allowedPoints(6, scoring)).toBe(7);
      expect(allowedPoints(21, scoring)).toBe(0);
      expect(allowedPoints(41, scoring)).toBe(-4);
    });

    it("doesn't count the shutout bonus a defense starts every game with", () => {
      // Just kicked off: 10 points for a shutout so far, nearly the whole game left
      const atKickoff = defenseExpected(10, true, 0, proj, 0.98, scoring);
      const before = defenseExpected(0, false, 0, proj, 1, scoring);
      expect(atKickoff).toBeLessThan(6);
      expect(Math.abs(atKickoff - before)).toBeLessThan(0.5);
    });

    it('projects a defense giving points back late in a high-scoring game', () => {
      // 31 allowed (-1) plus a sack and an interception (3), two minutes left
      const late = defenseExpected(2, true, 31, proj, 2 / 60, scoring);
      expect(late).toBeLessThan(2.2);
      expect(late).toBeGreaterThan(1.5);
      // and can go below zero
      expect(defenseExpected(-4, true, 38, { allowed: 24, other: 3 }, 0.5, scoring)).toBeLessThan(-2);
    });

    it('keeps the final points once the game is over', () => {
      expect(defenseExpected(6, true, 17, proj, 0, scoring)).toBeCloseTo(6);
    });
  });
});

describe('the NFL game line', () => {
  it("reads from the player's team's side, like Sleeper", () => {
    expect(gameMatchup({ state: 'in', remaining: 0.4, label: 'Q3 8:12', opponent: 'NO', home: true, score: 10, opponentScore: 17 })).toEqual({ score: '10-17', opponent: 'vs NO' });
    expect(gameMatchup({ state: 'post', remaining: 0, label: 'Final', opponent: 'SF', home: false, score: 24, opponentScore: 20 })).toEqual({ score: '24-20', opponent: '@ SF' });
    expect(gameMatchup({ state: 'pre', remaining: 1, label: 'Sun 1:00 PM ET', opponent: 'DAL', home: false })).toEqual({ opponent: '@ DAL' });
    expect(gameMatchup({ state: 'pre', remaining: 1, label: '' })).toBeNull();
  });
});

describe('driveFor', () => {
  // ESPN's yardLine counts from the home team's goal line; possession is the team ID with the ball
  const bal = { id: '33', code: 'BAL', home: true };
  const cin = { id: '4', code: 'CIN', home: false };

  it('reads the drive from each side (BAL at home, CIN with the ball at its own 12)', () => {
    const s = { down: 1, distance: 10, yardLine: 88, possession: '4' };
    expect(driveFor(s, cin, bal)).toEqual({ offense: true, downDistance: '1st & 10', spot: 'CIN 12', fromOwnGoal: 12 });
    expect(driveFor(s, bal, cin)).toEqual({ offense: false, downDistance: '1st & 10', spot: 'CIN 12', fromOwnGoal: 88 });
  });

  it('says Goal when the line to gain is the goal line, and 50 at midfield', () => {
    expect(driveFor({ down: 3, distance: 4, yardLine: 96, possession: '33' }, bal, cin)?.downDistance).toBe('3rd & Goal');
    expect(driveFor({ down: 3, distance: 4, yardLine: 96, possession: '33' }, bal, cin)?.spot).toBe('CIN 4');
    expect(driveFor({ down: 2, distance: 7, yardLine: 50, possession: '4' }, cin, bal)?.spot).toBe('50');
  });

  it('keeps the spot but drops the down between plays, and is null with no team on offense', () => {
    expect(driveFor({ down: -1, distance: 0, yardLine: 35, possession: '33' }, bal, cin)).toEqual({ offense: true, downDistance: null, spot: 'BAL 35', fromOwnGoal: 35 });
    expect(driveFor({ down: -1, distance: 0, yardLine: 85, possession: null }, bal, cin)).toBeNull();
    expect(driveFor(undefined, bal, cin)).toBeNull();
  });
});


describe('live odds at kickoff agree with the single-game model', () => {
  // Both forecast the same game: before any kickoff, the live spread for an average lineup in a
  // league whose weekly spread is the single-game model's should be the single-game margin spread
  it('gives the same margin spread when the league spread matches', () => {
    const weeks = strengthModel.singleGame.weeks as Record<string, Record<string, { sd: number }>>;
    for (const byAhead of Object.values(weeks)) {
      const sd = byAhead['1'].sd;
      const projections: Record<string, LiveProjection> = {};
      const games: Record<string, LiveGame> = { KC: { state: 'pre', remaining: 1, label: '' } };
      const matchups = [1, 2].map((r) => {
        const starters = ['QB', 'RB', 'WR', 'TE'].map((position, i) => {
          const id = `${r}-${i}`;
          projections[id] = { points: 15, spreadRatio: 0.6, team: 'KC', name: id, position, injury: null };
          return id;
        });
        return { roster_id: r, matchup_id: 1, starters, players: starters, players_points: {}, points: 0 } as SleeperMatchup;
      });
      const [odds] = liveWinOdds(matchups, projections, games, sd);
      expect(odds.sd).toBeCloseTo(Math.SQRT2 * sd, 6);
    }
  });
});

describe('odds from players\' real remaining-points distributions', () => {
  it('matches the research version (scripts/backtests/live_sim.py)', () => {
    for (const c of remainingOddsFixture as Array<{ current: number; players: Array<[string, number, number, number, number]>; defenses: Array<[number, number, number]>; odds: number }>) {
      const players = c.players.map(([position, projection, expected, remaining, sign]) => ({ position, projection, expected, remaining, sign: sign as 1 | -1 }));
      const defenses = c.defenses.map(([mean, sd, sign]) => ({ mean, sd, sign: sign as 1 | -1 }));
      expect(remainingPointsOdds(c.current, players, defenses)).toBeCloseTo(c.odds, 5);
    }
  });

  it('almost never lets a player lose the points a narrow lead needs', () => {
    // Up 0.61, the other team done, a WR projected 14.2 with 54% of his game left
    const ceedee: RemainingPlayer = { position: 'WR', projection: 14.2, expected: 14.2 * 0.54, remaining: 0.54, sign: 1 };
    expect(remainingPointsOdds(0.61, [ceedee], [])).toBeGreaterThan(0.995);
    // Down 3 instead: now he has to score, which a fair share of halves he doesn't
    const down = remainingPointsOdds(-3, [ceedee], []);
    expect(down).toBeGreaterThan(0.4);
    expect(down).toBeLessThan(0.95);
  });

  it('blends in gradually as one team runs out of players', () => {
    expect(simulationWeight(0.06)).toBe(0);
    expect(simulationWeight(0.03)).toBeCloseTo(0.5);
    expect(simulationWeight(0.005)).toBe(1);
  });

  it('takes over in liveWinOdds when one team is done', () => {
    const games: Record<string, LiveGame> = { DAL: { state: 'in', remaining: 0.54, label: '' }, KC: { state: 'post', remaining: 0, label: '' } };
    const projections: Record<string, LiveProjection> = {
      cd: { points: 14.2, spreadRatio: 0.6, team: 'DAL', name: 'CeeDee', position: 'WR', injury: null },
      done: { points: 15, spreadRatio: 0.6, team: 'KC', name: 'Done', position: 'WR', injury: null },
    };
    const m = (r: number, starters: string[], pts: number) =>
      ({ roster_id: r, matchup_id: 1, starters, players: starters, players_points: Object.fromEntries(starters.map((id) => [id, pts])), points: pts }) as SleeperMatchup;
    const [close] = liveWinOdds([m(1, ['cd'], 111.49), m(2, ['done'], 110.88)], projections, games, 25);
    expect(close.aWinOdds).toBeGreaterThan(0.995);
    // Far behind: his real chances of a big half, not the normal's
    const [far] = liveWinOdds([m(1, ['cd'], 90), m(2, ['done'], 110.88)], projections, games, 25);
    expect(far.aWinOdds).toBeCloseTo(remainingPointsOdds(90 - 110.88, [{ position: 'WR', projection: 14.2, expected: 14.2 * 0.54, remaining: 0.54, sign: 1 }], []), 9);
    // Both teams with players left: the normal model as before
    const both = { ...games, KC: { state: 'in' as const, remaining: 0.5, label: '' } };
    const [mid] = liveWinOdds([m(1, ['cd'], 90), m(2, ['done'], 100)], projections, both, 25);
    expect(mid.aWinOdds).toBeCloseTo(normalCdfFor(90 + 14.2 * 0.54 - (100 + 15 * 0.5), mid.sd), 9);
  });
});

function normalCdfFor(diff: number, sd: number) {
  const x = Math.abs(diff / sd) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return diff >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}
