import { describe, it, expect } from 'vitest';
import {
  seedTeams,
  projectedBracket,
  bestLineupPoints,
  teamStrength,
  simulatePlayoffOdds,
  statusFor,
  playoffScenarios,
  pointsRaces,
  toiletSeeds,
  projectedToiletBracket,
  type OddsTeam,
  type PlayoffFormat,
  type RemainingGame,
} from '../analyze/playoffOdds';

const team = (rosterId: number, division: number, wins: number, losses: number, pointsFor = 1000): OddsTeam => ({
  rosterId, teamName: `T${rosterId}`, username: `u${rosterId}`, division, wins, losses, ties: 0, pointsFor,
});

// 6 teams, 2 divisions, 3 playoff spots (2 division winners + 1 wild card), 1 bye
const FORMAT: PlayoffFormat = { playoffTeams: 3, hasDivisions: true, byes: 1 };

describe('seedTeams', () => {
  it('gives division winners the top seeds even with a worse record', () => {
    const teams = [team(1, 1, 8, 2), team(2, 1, 7, 3), team(3, 2, 5, 5), team(4, 2, 4, 6)];
    const { seeds, divisionWinners } = seedTeams(teams, { playoffTeams: 3, hasDivisions: true, byes: 2 });
    expect([...divisionWinners].sort()).toEqual([1, 3]);
    expect(seeds).toEqual([1, 3, 2]);
  });

  it('breaks ties on record with points for', () => {
    const teams = [team(1, 0, 5, 5, 900), team(2, 0, 5, 5, 950), team(3, 0, 4, 6, 2000)];
    expect(seedTeams(teams, { playoffTeams: 2, hasDivisions: false, byes: 1 }).seeds).toEqual([2, 1]);
  });

  it('counts a tie as half a win', () => {
    const tied = { ...team(1, 0, 5, 4, 0), ties: 1 };
    const teams = [tied, team(2, 0, 5, 5, 9999)];
    expect(seedTeams(teams, { playoffTeams: 1, hasDivisions: false, byes: 0 }).seeds).toEqual([1]);
  });
});

describe('projectedBracket', () => {
  it('matches the league bracket: 4 v 5, 3 v 6, then 1 and 2 host', () => {
    const games = projectedBracket([11, 12, 13, 14, 15, 16], 15);
    expect(games.map((g) => g.label)).toEqual(['Round 1', 'Round 1', 'Semifinal', 'Semifinal', 'Final']);
    expect(games[0]).toMatchObject({ week: 15, top: { seed: 4, rosterId: 14 }, bottom: { seed: 5, rosterId: 15 } });
    expect(games[1]).toMatchObject({ top: { seed: 3 }, bottom: { seed: 6 } });
    expect(games[2]).toMatchObject({ week: 16, top: { seed: 1, rosterId: 11 }, bottom: { from: 'Winner of 4 v 5' } });
    expect(games[3]).toMatchObject({ top: { seed: 2 }, bottom: { from: 'Winner of 3 v 6' } });
    expect(games[4].week).toBe(17);
  });

  it('is empty without six seeds', () => {
    expect(projectedBracket([1, 2, 3], 15)).toEqual([]);
  });
});

describe('bestLineupPoints', () => {
  it('fills dedicated slots first, then flex, including K and DEF', () => {
    const proj = {
      qb: { position: 'QB', points: 20 },
      rb1: { position: 'RB', points: 15 },
      rb2: { position: 'RB', points: 12 },
      wr1: { position: 'WR', points: 14 },
      te: { position: 'TE', points: 9 },
      k: { position: 'K', points: 8 },
      dst: { position: 'DEF', points: 7 },
    };
    const players = Object.keys(proj);
    // RB slot takes rb1; flex takes rb2 (12) over nothing better; WR takes wr1
    expect(bestLineupPoints(players, proj, ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN'])).toBe(20 + 15 + 14 + 9 + 12 + 8 + 7);
  });

  it('ignores players without projections and leaves unfillable slots empty', () => {
    expect(bestLineupPoints(['x'], { qb: { position: 'QB', points: 20 } }, ['QB', 'RB'])).toBe(0);
  });
});

describe('teamStrength', () => {
  const scores = { 1: [120, 130], 2: [80, 90] };

  it('uses shrunk season form without projections', () => {
    const { meanByWeek, spread } = teamStrength(scores, [3, 4], null);
    // league 105; team 1: (250 + 2*105) / 4 = 115
    expect(meanByWeek[3][1]).toBeCloseTo(115);
    expect(meanByWeek[4][2]).toBeCloseTo(95);
    expect(spread).toBe(15); // floored
  });

  it('blends each week\'s centered projections 75/25 with form', () => {
    // Week 3: team 1 has players on bye; week 4 it's back to full strength
    const { meanByWeek } = teamStrength(scores, [3, 4], { 3: { 1: 100, 2: 140 }, 4: { 1: 140, 2: 140 } });
    // Week 3 centered on league 105: team 1 -> 85, team 2 -> 125
    expect(meanByWeek[3][1]).toBeCloseTo(0.75 * 85 + 0.25 * 115);
    expect(meanByWeek[3][2]).toBeCloseTo(0.75 * 125 + 0.25 * 95);
    // Week 4: equal projections -> both centered at 105
    expect(meanByWeek[4][1]).toBeCloseTo(0.75 * 105 + 0.25 * 115);
  });

  it('falls back to form for a week missing a team\'s projection', () => {
    const { meanByWeek } = teamStrength(scores, [3], { 3: { 1: 100 } });
    expect(meanByWeek[3][1]).toBeCloseTo(115);
  });
});

describe('simulatePlayoffOdds', () => {
  const teams = [team(1, 1, 3, 1), team(2, 1, 2, 2), team(3, 1, 1, 3), team(4, 2, 3, 1), team(5, 2, 2, 2), team(6, 2, 1, 3)];
  const remaining: RemainingGame[] = [
    { week: 5, a: 1, b: 2 }, { week: 5, a: 3, b: 4 }, { week: 5, a: 5, b: 6 },
    { week: 6, a: 1, b: 3 }, { week: 6, a: 2, b: 5 }, { week: 6, a: 4, b: 6 },
  ];
  const perTeam = { 1: 110, 2: 100, 3: 100, 4: 100, 5: 100, 6: 90 };
  const mean = { 5: perTeam, 6: perTeam };

  it('produces consistent totals', () => {
    const { teams: odds } = simulatePlayoffOdds(teams, remaining, FORMAT, mean, 20, 4000);
    const sum = (f: (o: (typeof odds)[number]) => number) => Object.values(odds).reduce((s, o) => s + f(o), 0);
    expect(sum((o) => o.playoffs)).toBeCloseTo(3);
    expect(sum((o) => o.division)).toBeCloseTo(2);
    expect(sum((o) => o.bye)).toBeCloseTo(1);
    for (const o of Object.values(odds)) expect(o.seedOdds.reduce((s, v) => s + v, 0)).toBeCloseTo(o.playoffs);
  });

  it('is deterministic for a given seed', () => {
    const a = simulatePlayoffOdds(teams, remaining, FORMAT, mean, 20, 2000, 7);
    const b = simulatePlayoffOdds(teams, remaining, FORMAT, mean, 20, 2000, 7);
    expect(a.teams[1].playoffs).toBe(b.teams[1].playoffs);
  });

  it('reports how this week changes the odds', () => {
    const { teams: odds, nextWeekGames } = simulatePlayoffOdds(teams, remaining, FORMAT, mean, 20, 4000);
    expect(nextWeekGames.map((g) => g.week)).toEqual([5, 5, 5]);
    expect(odds[2].ifWin!).toBeGreaterThan(odds[2].ifLoss!);
  });
});

describe('statusFor', () => {
  const div = new Map([[1, 1], [2, 1], [3, 1], [4, 2], [5, 2], [6, 2]]);
  const rec = (r: number[]) => new Map(r.map((v, i) => [i + 1, v]));

  it('division winner is in', () => {
    expect(statusFor(1, rec([9, 5, 5, 8, 7, 4]), div, FORMAT)).toEqual({ playoffs: 'in', division: 'in' });
  });

  it('a tie for a division lead or the last spot depends on points', () => {
    // 1 and 2 tie for division 1; wild card: 1 spot
    expect(statusFor(1, rec([7, 7, 2, 9, 3, 1]), div, FORMAT)).toEqual({ playoffs: 'in', division: 'points' });
    // 2 and 5 tie for the wild card behind division winners 1 and 4
    expect(statusFor(2, rec([9, 6, 2, 9, 6, 1]), div, FORMAT).playoffs).toBe('points');
  });

  it('out when too many non-winners are ahead', () => {
    expect(statusFor(3, rec([9, 8, 2, 9, 8, 1]), div, FORMAT)).toEqual({ playoffs: 'out', division: 'out' });
  });
});

describe('playoffScenarios', () => {
  // One week left. Div 1: 1 (8-4), 2 (7-5), 3 (3-9). Div 2: 4 (9-3), 5 (6-6), 6 (2-10).
  const teams = [team(1, 1, 8, 4), team(2, 1, 7, 5), team(3, 1, 3, 9), team(4, 2, 9, 3), team(5, 2, 6, 6), team(6, 2, 2, 10)];
  const lastWeek: RemainingGame[] = [{ week: 13, a: 1, b: 2 }, { week: 13, a: 3, b: 5 }, { week: 13, a: 4, b: 6 }];

  it('finds clinches, eliminations and what each team needs', () => {
    const s = playoffScenarios(teams, lastWeek, FORMAT);
    expect(s[4]).toMatchObject({ exact: true, clinchedPlayoffs: true, clinchedDivision: true });
    expect(s[1]).toMatchObject({ clinchedPlayoffs: true, clinchedDivision: false, winOutAndDivision: true });
    expect(s[3]).toMatchObject({ eliminated: true, eliminatedFromDivision: true });
    expect(s[6].eliminated).toBe(true);
    // If 2 beats 1 they're both 8-5 and the loser of that points tiebreak is
    // still the wild card, so a win gets 2 in. If 2 loses (7-6) and 5 wins
    // (7-6), the wild card comes down to points.
    expect(s[2]).toMatchObject({ clinchedPlayoffs: false, winOutAndIn: true });
    // 5 isn't out yet, but even winning only gets it to a points tiebreak, and
    // only if 2 loses
    expect(s[5]).toMatchObject({ eliminated: false, winOutAndIn: false, winOutPointsAtWorst: false });
  });

  it('identifies win-and-in and the help a team needs', () => {
    // 3 teams chasing one wild card with one week left
    const t = [team(1, 1, 10, 2), team(2, 1, 7, 5), team(3, 1, 7, 5), team(4, 2, 10, 2), team(5, 2, 6, 6), team(6, 2, 2, 10)];
    const games: RemainingGame[] = [{ week: 13, a: 2, b: 4 }, { week: 13, a: 3, b: 6 }, { week: 13, a: 1, b: 5 }];
    const s = playoffScenarios(t, games, FORMAT);
    // 2 wins -> 8-5; 3 can also reach 8-5: 2 needs 3 to lose, or wins on points
    expect(s[2].winOutAndIn).toBe(false);
    expect(s[2].winOutPointsAtWorst).toBe(true);
    expect(s[2].helpNeeded).toEqual([{ winner: 6, loser: 3, week: 13 }]);
    // 5 at best 7-6 can tie 2 and 3 only if both lose: depends on points at best
    expect(s[5].eliminated).toBe(false);
    expect(s[5].winOutAndIn).toBe(false);
  });

  it('uses safe bounds when too many games remain to enumerate', () => {
    const t = [team(1, 1, 9, 0), team(2, 1, 0, 9), team(3, 1, 0, 9), team(4, 2, 5, 4), team(5, 2, 4, 5), team(6, 2, 4, 5)];
    const games: RemainingGame[] = [];
    for (let w = 10; w <= 16; w++) games.push({ week: w, a: 1, b: 2 }, { week: w, a: 3, b: 4 }, { week: w, a: 5, b: 6 });
    const s = playoffScenarios(t, games, FORMAT);
    expect(s[1].exact).toBe(false);
    // 1 at 9 wins can be caught by nobody in its division (rivals max 7)
    expect(s[1].clinchedDivision).toBe(true);
    expect(s[4].clinchedPlayoffs).toBe(false);
    expect(s[4].eliminated).toBe(false);
  });

  it('enumerates three weeks of a 12-team league quickly', () => {
    const t = Array.from({ length: 12 }, (_, i) => team(i + 1, (i % 3) + 1, 5 + (i % 4), 6 - (i % 4)));
    const games: RemainingGame[] = [];
    for (let w = 12; w <= 14; w++) for (let k = 0; k < 6; k++) games.push({ week: w, a: ((k + w) % 12) + 1, b: ((k + w + 6) % 12) + 1 });
    const start = Date.now();
    const s = playoffScenarios(t, games, { playoffTeams: 6, hasDivisions: true, byes: 2 });
    expect(Object.values(s).every((x) => x.exact)).toBe(true);
    expect(Date.now() - start).toBeLessThan(10000);
  });
});

describe('pointsRaces', () => {
  it('finds teams level on record across the playoff line and for division leads', () => {
    const t = [team(1, 1, 8, 4, 1500), team(2, 1, 8, 4, 1400), team(3, 1, 7, 5, 1300), team(4, 2, 9, 3), team(5, 2, 7, 5, 1350), team(6, 2, 2, 10)];
    const r = pointsRaces(t, FORMAT);
    // Division 1 lead decided on points: 1 ahead of 2 by 100
    expect(r[1]).toContainEqual({ rival: 2, margin: 100, kind: 'division' });
    expect(r[2]).toContainEqual({ rival: 1, margin: -100, kind: 'division' });
    // Wild card is 2 (8-4); no one else at 8-4 outside, so no cutoff race
    expect(r[5]).toBeUndefined();
  });
});

describe('toilet bowl', () => {
  it('seeds non-playoff teams worst first, ties going to fewer points for', () => {
    const teams = [
      team(1, 0, 9, 1), team(2, 0, 3, 7, 900), team(3, 0, 5, 5, 1200),
      team(4, 0, 5, 5, 1100), team(5, 0, 1, 9), team(6, 0, 8, 2),
    ];
    // Playoff seeds 1 and 6; of the rest, 5 is worst, then 2, then 4 (5-5, fewer points) before 3
    expect(toiletSeeds(teams, [1, 6])).toEqual([5, 2, 4, 3]);
  });

  it('builds the lower-score-advances bracket', () => {
    const games = projectedToiletBracket([21, 22, 23, 24, 25, 26], 15);
    expect(games.map((g) => g.label)).toEqual(['Round 1', 'Round 1', 'Semifinal', 'Semifinal', 'Last-place game']);
    expect(games[0]).toMatchObject({ top: { seed: 4, rosterId: 24 }, bottom: { seed: 5, rosterId: 25 } });
    expect(games[1]).toMatchObject({ top: { seed: 3 }, bottom: { seed: 6 } });
    expect(games[2]).toMatchObject({ week: 16, top: { seed: 1, rosterId: 21 }, bottom: { from: 'Lower score of 4 v 5' } });
    expect(games[4].week).toBe(17);
    expect(projectedToiletBracket([1, 2, 3], 15)).toEqual([]);
  });

  // 12 teams, 6 playoff spots, so 6 in the toilet bowl
  const twelve = Array.from({ length: 12 }, (_, i) => team(i + 1, (i % 3) + 1, 6, 6));
  const games: RemainingGame[] = [];
  for (let k = 0; k < 6; k++) games.push({ week: 14, a: k + 1, b: k + 7 });
  const means = (weakest: number) => {
    const m: Record<number, number> = {};
    for (let i = 1; i <= 12; i++) m[i] = i === weakest ? 60 : 110;
    return { 14: m, 15: m, 16: m, 17: m };
  };
  const big: PlayoffFormat = { playoffTeams: 6, hasDivisions: true, byes: 2 };

  it('simulates last place when the toilet bowl has six teams', () => {
    const { teams: odds } = simulatePlayoffOdds(twelve, games, big, means(12), 20, 4000, 1, 15);
    const total = Object.values(odds).reduce((s, o) => s + (o.lastPlace ?? 0), 0);
    expect(total).toBeCloseTo(1);
    const ranked = Object.values(odds).sort((a, b) => (b.lastPlace ?? 0) - (a.lastPlace ?? 0));
    // The far weakest team is the most likely to finish last
    expect(ranked[0].rosterId).toBe(12);
  });

  it('simulates the championship: higher score advances', () => {
    // 12 is far stronger than everyone this time
    const strong: Record<number, number> = {};
    for (let i = 1; i <= 12; i++) strong[i] = i === 12 ? 200 : 100;
    const m = { 14: strong, 15: strong, 16: strong, 17: strong };
    const { teams: odds } = simulatePlayoffOdds(twelve, games, big, m, 20, 4000, 1, 15);
    const total = Object.values(odds).reduce((s, o) => s + (o.champion ?? 0), 0);
    expect(total).toBeCloseTo(1);
    // Champion must have made the playoffs
    for (const o of Object.values(odds)) expect(o.champion!).toBeLessThanOrEqual(o.playoffs + 1e-9);
    expect(odds[12].champion!).toBeGreaterThan(0.8);
  });

  it('can skip the toilet bowl but still simulate the championship', () => {
    const { teams: odds } = simulatePlayoffOdds(twelve, games, big, means(12), 20, 500, 1, 15, false);
    expect(odds[1].lastPlace).toBeNull();
    expect(odds[1].champion).not.toBeNull();
  });

  it('leaves last place out without a playoff start week or a six-team toilet bowl', () => {
    expect(simulatePlayoffOdds(twelve, games, big, means(12), 20, 500, 1).teams[1].lastPlace).toBeNull();
    expect(simulatePlayoffOdds(twelve, games, big, means(12), 20, 500, 1).teams[1].champion).toBeNull();
    const t6 = twelve.slice(0, 6);
    const g6: RemainingGame[] = [{ week: 14, a: 1, b: 2 }];
    expect(simulatePlayoffOdds(t6, g6, { playoffTeams: 3, hasDivisions: false, byes: 1 }, means(6), 20, 500, 1, 15).teams[1].lastPlace).toBeNull();
  });
});
