import { describe, it, expect } from 'vitest';
import { against, middleHalf, summarize, teamSeasonDecisions } from '../analyze/decisions';
import type { SeasonInsights, TeamWeek, WaiverMove } from '../analyze/insights';

const players = {
  qb1: { name: 'QB One', position: 'QB', team: null },
  qb2: { name: 'QB Two', position: 'QB', team: null },
  rb1: { name: 'RB One', position: 'RB', team: null },
  rb2: { name: 'RB Two', position: 'RB', team: null },
  rb3: { name: 'RB Three', position: 'RB', team: null },
};

/** A week: starters and bench with their projections and points; the projection-best lineup worked out here */
function week(w: number, starters: Record<string, [number, number]>, bench: Record<string, [number, number]>, opponentPoints: number | null = null, unprojected: string[] = []): TeamWeek {
  const all = { ...starters, ...bench };
  // QB + RB + FLEX(RB): best by projection
  const by = (pos: string) => Object.entries(all).filter(([id]) => players[id as keyof typeof players].position === pos).sort((a, b) => b[1][0] - a[1][0]);
  const qb = by('QB')[0];
  const rbs = by('RB').slice(0, 2);
  const best = [qb, ...rbs];
  const points = Object.values(starters).reduce((s, [, p]) => s + p, 0);
  return {
    week: w,
    opponent: 2,
    points,
    opponentPoints,
    optimal: 0,
    projected: Object.values(starters).reduce((s, [p]) => s + p, 0),
    projectedBest: best.reduce((s, [, [, p]]) => s + p, 0),
    projectedBestProjected: best.reduce((s, [, [p]]) => s + p, 0),
    starters: Object.keys(starters),
    playerPoints: Object.fromEntries(Object.entries(all).map(([id, [, p]]) => [id, p])),
    starterProjections: Object.fromEntries(Object.entries(starters).map(([id, [p]]) => [id, p])),
    benchProjections: Object.fromEntries(Object.entries(bench).map(([id, [p]]) => [id, p])),
    unprojected,
  };
}

const insights = (weeks: TeamWeek[], waivers: WaiverMove[] = [], extra: Partial<SeasonInsights> = {}): SeasonInsights => ({
  season: '2024',
  regularSeasonEnd: 14,
  weeks: weeks.length,
  complete: true,
  rosterPositions: ['QB', 'RB', 'FLEX', 'BN', 'BN'],
  faabBudget: null,
  faabUsed: {},
  players,
  teams: { 1: weeks },
  waivers,
  generatedAt: '',
  ...extra,
});

const add = (week: number, playerId: string): WaiverMove => ({ week, rosterId: 1, playerId, type: 'free_agent', bid: null, losingBids: [], dropped: [], startedPoints: 7, startedWeeks: 1 });

describe('teamSeasonDecisions', () => {
  it('counts the projections’ lineup, overrides at 1 point, and what they did', () => {
    const [d] = teamSeasonDecisions(
      insights([
        // Projections' lineup
        week(1, { qb1: [20, 18], rb1: [12, 10], rb2: [10, 8] }, { rb3: [9, 30], qb2: [15, 5] }, 30),
        // 0.5 below the best: still the projections' lineup
        week(2, { qb1: [20, 18], rb1: [12, 10], rb3: [9.5, 8] }, { rb2: [10, 8], qb2: [15, 5] }, 30),
        // Override: RB Three (9) over RB Two (10) and it paid off, winning a game the projections' lineup would have lost
        week(3, { qb1: [20, 18], rb1: [12, 10], rb3: [9, 30] }, { rb2: [10, 2], qb2: [15, 5] }, 40),
        // Override that cost a game
        week(4, { qb1: [20, 18], rb1: [12, 10], rb3: [8, 0] }, { rb2: [10, 15], qb2: [15, 5] }, 35),
      ])
    );
    expect(d.weeks).toBe(4);
    expect(d.projectionLineupWeeks).toBe(2);
    expect(d.overrides.map((o) => [o.week, o.projectedCost, o.actual, o.flipped])).toEqual([
      [3, 1, 28, 'won'],
      [4, 2, -15, 'lost'],
    ]);
    expect(d.overrides[0].started).toEqual(['rb3']);
    expect(d.overrides[0].benched).toEqual(['rb2']);
    expect(d.projectedGivenUp).toBeCloseTo(3.5);
  });

  it('counts a starter projected at 0 as starting someone who couldn’t play, not as an override', () => {
    const [d] = teamSeasonDecisions(insights([week(1, { qb1: [20, 18], rb1: [12, 10], rb2: [0, 0] }, { rb3: [9, 6], qb2: [15, 5] })]));
    expect(d.noShows).toEqual([{ week: 1, playerId: 'rb2' }]);
    expect(d.overrides).toEqual([]);
    expect(d.projectionLineupWeeks).toBe(0);
  });

  it('leaves out a week with a starter Sleeper didn’t project, and files built before the new fields', () => {
    const [d] = teamSeasonDecisions(insights([week(1, { qb1: [20, 18], rb1: [12, 10], rb2: [0, 0] }, { rb3: [9, 6], qb2: [15, 5] }, null, ['rb2'])]));
    expect(d.weeks).toBe(0);
    const old = week(2, { qb1: [20, 18], rb1: [12, 10], rb2: [10, 8] }, { rb3: [9, 6], qb2: [15, 5] });
    delete old.benchProjections;
    delete old.projectedBestProjected;
    expect(teamSeasonDecisions(insights([old]))[0].weeks).toBe(0);
    expect(teamSeasonDecisions(insights([week(1, { qb1: [20, 18], rb1: [12, 10], rb2: [10, 8] }, { rb3: [9, 6] })], [], { rosterPositions: undefined }))[0].weeks).toBe(0);
  });

  it('calls an add proactive when the lineup was full without it, a fill when it wasn’t', () => {
    const [d] = teamSeasonDecisions(
      insights(
        [
          // Without RB Three the roster still has two RBs projected to play
          week(1, { qb1: [20, 18], rb1: [12, 10], rb2: [10, 8] }, { rb3: [9, 6] }),
          // Without RB Three only one RB projected to play (RB Two on bye)
          week(2, { qb1: [20, 18], rb1: [12, 10], rb3: [9, 6] }, { rb2: [0, 0] }),
        ],
        [add(1, 'rb3'), add(2, 'rb3')]
      )
    );
    expect(d.pickups.map((p) => p.proactive)).toEqual([true, false]);
  });
});

describe('summaries and the league band', () => {
  it('adds seasons up, per season where it says so', () => {
    const one = teamSeasonDecisions(insights([week(3, { qb1: [20, 18], rb1: [12, 10], rb3: [9, 30] }, { rb2: [10, 2], qb2: [15, 5] }, 40)], [add(3, 'rb3')]))[0];
    const s = summarize([one, { ...one, season: '2025' }]);
    expect(s.seasons).toBe(2);
    expect(s.overrides).toBe(2);
    expect(s.gamesWon).toBe(2);
    // One week judged each season, at a 14-week season's pace
    expect(s.givenUpPerSeason).toBeCloseTo(14);
    expect(s.proactivePerSeason).toBe(14);
    expect(s.pickupPoints).toBe(14);
  });

  it('finds the middle half and where a value sits', () => {
    const band = middleHalf([1, 2, 3, 4, 5]);
    expect(band).toEqual([2, 4]);
    expect(against(1, band)).toBe('below');
    expect(against(3, band)).toBe('typical');
    expect(against(5, band)).toBe('above');
    expect(middleHalf([1, 2])).toBeNull();
  });
});
