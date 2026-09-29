import { describe, it, expect } from 'vitest';
import {
  median,
  buildDraftData,
  buildSnakeBoard,
  buildSnakeSlotTeams,
  buildAuctionBoardByTeam,
  summarizeDraftByTeam,
  positionBadgeClass,
  withAvailability,
  type DraftData,
  type DraftPickData,
} from '../analyze/draft';
import type { SleeperDraft, SleeperDraftPick, SleeperPlayerWeekStats, SleeperRoster } from '../types';

function makePick(overrides: Partial<DraftPickData> = {}): DraftPickData {
  return {
    pick_no: 1,
    round: 1,
    draft_slot: 1,
    roster_id: 1,
    player_id: '1',
    name: 'Test Player',
    position: 'RB',
    nfl_team: 'DET',
    amount: null,
    weekly: [10, 12, 14],
    games: 3,
    median_ppg: 12,
    total: 36,
    ...overrides,
  };
}

describe('median', () => {
  it('returns 0 for empty input', () => {
    expect(median([])).toBe(0);
  });

  it('returns the middle value for odd-length arrays', () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it('averages the two middle values for even-length arrays', () => {
    expect(median([40, 10, 20, 30])).toBe(25);
  });

  it('resists a single boom-week spike better than the mean', () => {
    const weeks = [9, 10, 11, 10, 45]; // one spike week
    const mean = weeks.reduce((a, b) => a + b, 0) / weeks.length;
    expect(median(weeks)).toBe(10);
    expect(mean).toBeGreaterThan(median(weeks));
  });
});

describe('buildSnakeBoard', () => {
  it('places picks by round and draft slot', () => {
    const picks = [
      makePick({ pick_no: 1, round: 1, draft_slot: 1, name: 'A' }),
      makePick({ pick_no: 2, round: 1, draft_slot: 2, name: 'B' }),
      makePick({ pick_no: 3, round: 2, draft_slot: 2, name: 'C' }),
      makePick({ pick_no: 4, round: 2, draft_slot: 1, name: 'D' }),
    ];
    const rows = buildSnakeBoard(picks, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0].cells.map((c) => c?.name)).toEqual(['A', 'B']);
    // serpentine is inherent in the slot data: round 2 reverses
    expect(rows[1].cells.map((c) => c?.name)).toEqual(['D', 'C']);
  });

  it('leaves nulls for missing slots', () => {
    const picks = [makePick({ pick_no: 1, round: 1, draft_slot: 2 })];
    const rows = buildSnakeBoard(picks, 3);
    expect(rows[0].cells[0]).toBeNull();
    expect(rows[0].cells[1]?.pick_no).toBe(1);
    expect(rows[0].cells[2]).toBeNull();
  });

  it('returns no rows for no picks', () => {
    expect(buildSnakeBoard([], 12)).toEqual([]);
  });
});

describe('buildSnakeSlotTeams', () => {
  it('maps each slot to the roster holding it in round 1', () => {
    const picks = [
      makePick({ pick_no: 1, round: 1, draft_slot: 1, roster_id: 7 }),
      makePick({ pick_no: 2, round: 1, draft_slot: 2, roster_id: 3 }),
      makePick({ pick_no: 3, round: 2, draft_slot: 2, roster_id: 3 }),
      makePick({ pick_no: 4, round: 2, draft_slot: 1, roster_id: 7 }),
    ];
    expect(buildSnakeSlotTeams(picks, 3)).toEqual([7, 3, null]);
  });

  it('ignores later rounds when deriving slot holders', () => {
    const picks = [makePick({ pick_no: 24, round: 2, draft_slot: 1, roster_id: 9 })];
    expect(buildSnakeSlotTeams(picks, 2)).toEqual([null, null]);
  });
});

describe('buildAuctionBoardByTeam', () => {
  it('groups picks by roster, sorted by price descending', () => {
    const picks = [
      makePick({ pick_no: 1, roster_id: 1, amount: 5, name: 'Cheap' }),
      makePick({ pick_no: 2, roster_id: 1, amount: 50, name: 'Star' }),
      makePick({ pick_no: 3, roster_id: 2, amount: 40, name: 'Mid' }),
    ];
    const boards = buildAuctionBoardByTeam(picks);
    expect(boards).toHaveLength(2);
    const team1 = boards.find((b) => b.rosterId === 1)!;
    expect(team1.picks.map((p) => p.name)).toEqual(['Star', 'Cheap']);
    expect(team1.spent).toBe(55);
  });

  it('orders teams by weekly haul descending', () => {
    const picks = [
      makePick({ pick_no: 1, roster_id: 1, median_ppg: 5, amount: 50 }),
      makePick({ pick_no: 2, roster_id: 2, median_ppg: 20, amount: 40 }),
    ];
    const boards = buildAuctionBoardByTeam(picks);
    expect(boards.map((b) => b.rosterId)).toEqual([2, 1]);
    expect(boards[0].haul).toBe(20);
    expect(boards[0].haulHealthy).toBe(20);
  });

  it('returns an empty board for no picks', () => {
    expect(buildAuctionBoardByTeam([])).toEqual([]);
  });
});

describe('summarizeDraftByTeam', () => {
  it('aggregates haul, spend, and best pick per roster', () => {
    const picks = [
      makePick({ pick_no: 1, roster_id: 1, median_ppg: 20, amount: 50, name: 'Star' }),
      makePick({ pick_no: 2, roster_id: 1, median_ppg: 8, amount: 5, name: 'Role' }),
      makePick({ pick_no: 3, roster_id: 2, median_ppg: 15, amount: 40, name: 'Mid' }),
    ];
    const summaries = summarizeDraftByTeam(picks);
    expect(summaries).toHaveLength(2);
    // sorted by haul descending
    expect(summaries[0].rosterId).toBe(1);
    expect(summaries[0].haul).toBe(28);
    expect(summaries[0].haulHealthy).toBe(28);
    expect(summaries[0].spent).toBe(55);
    expect(summaries[0].dollarsPerPoint).toBeCloseTo(55 / 28, 2);
    expect(summaries[0].bestPick?.name).toBe('Star');
    expect(summaries[1].bestPick?.name).toBe('Mid');
  });

  it('grades by points per available week, not median when healthy', () => {
    const picks = [
      // 25/game but hurt after week 2 of 16 available
      makePick({ pick_no: 1, roster_id: 1, median_ppg: 25, ppw: 3.13, amount: 60, name: 'Hurt Star' }),
      makePick({ pick_no: 2, roster_id: 2, median_ppg: 12, ppw: 11.5, amount: 20, name: 'Steady' }),
    ];
    const summaries = summarizeDraftByTeam(picks);
    expect(summaries.map((s) => s.rosterId)).toEqual([2, 1]);
    expect(summaries[1].haul).toBe(3.13);
    expect(summaries[1].haulHealthy).toBe(25);
    expect(summaries[1].dollarsPerPoint).toBeCloseTo(60 / 3.13, 2);
    expect(buildAuctionBoardByTeam(picks).map((b) => b.rosterId)).toEqual([2, 1]);

    const both = picks.map((p) => ({ ...p, roster_id: 1 }));
    expect(summarizeDraftByTeam(both)[0].bestPick?.name).toBe('Steady');
  });

  it('handles snake drafts with no amounts', () => {
    const picks = [makePick({ pick_no: 1, roster_id: 1, amount: null })];
    const [summary] = summarizeDraftByTeam(picks);
    expect(summary.spent).toBe(0);
    expect(summary.dollarsPerPoint).toBeNull();
  });
});

describe('positionBadgeClass', () => {
  it('returns a class for known positions and a fallback otherwise', () => {
    expect(positionBadgeClass('QB')).toContain('red');
    expect(positionBadgeClass('WR')).toContain('blue');
    expect(positionBadgeClass('XX')).toContain('zinc');
    expect(positionBadgeClass(null)).toContain('zinc');
  });
});

describe('buildDraftData', () => {
  const rosters = [
    { roster_id: 1, owner_id: 'u1' },
    { roster_id: 2, owner_id: 'u2' },
  ] as SleeperRoster[];

  const snakeDraft: SleeperDraft = {
    draft_id: 'd1',
    season: '2026',
    type: 'snake',
    status: 'complete',
    settings: { teams: 2, rounds: 1 },
    slot_to_roster_id: { '1': 2, '2': 1 },
  };

  const picks: SleeperDraftPick[] = [
    {
      pick_no: 2, round: 1, draft_slot: 2, player_id: 'p2', picked_by: 'u1',
      metadata: { first_name: 'Bo', last_name: 'Nix', position: 'QB', team: 'DEN', amount: '' },
    },
    {
      pick_no: 1, round: 1, draft_slot: 1, player_id: 'p1', picked_by: 'u2',
      metadata: { first_name: 'Bijan', last_name: 'Robinson', position: 'RB', team: 'ATL', amount: '' },
    },
  ];

  const weeklyStats: Record<string, SleeperPlayerWeekStats>[] = [
    { p1: { gp: 1, pts_half_ppr: 20.456 }, p2: { gp: 1, pts_half_ppr: 18 } },
    { p1: { gp: 1, pts_half_ppr: 10 }, p2: { gp: 0, pts_half_ppr: 0 } },
    { p1: { gp: 1, pts_half_ppr: 30 } },
  ];

  it('counts every scored week passed in', () => {
    expect(buildDraftData(snakeDraft, picks, rosters, weeklyStats).weeks_scored).toBe(3);
  });

  it('builds per-pick production from games played only', () => {
    const data = buildDraftData(snakeDraft, picks, rosters, weeklyStats);
    expect(data.picks.map((p) => p.pick_no)).toEqual([1, 2]);

    const [bijan, nix] = data.picks;
    expect(bijan.weekly).toEqual([20.46, 10, 30]);
    expect(bijan.games).toBe(3);
    expect(bijan.median_ppg).toBe(20.46);
    expect(bijan.total).toBe(60.46);
    expect(bijan.name).toBe('Bijan Robinson');
    expect(bijan.amount).toBeNull();

    // gp 0 in week 2 and absent in week 3: only week 1 counts
    expect(nix.weekly).toEqual([18]);
    expect(nix.games).toBe(1);
  });

  it('maps snake picks to rosters by draft slot', () => {
    const data = buildDraftData(snakeDraft, picks, rosters, weeklyStats);
    expect(data.picks.map((p) => p.roster_id)).toEqual([2, 1]);
    expect(data.budget).toBeNull();
  });

  it('maps auction picks to rosters by drafter and parses prices', () => {
    const auction: SleeperDraft = { ...snakeDraft, type: 'auction', settings: { teams: 2, rounds: 1, budget: 200 } };
    const auctionPicks = picks.map((p, i) => ({ ...p, metadata: { ...p.metadata, amount: String(50 - i) } }));
    const data = buildDraftData(auction, auctionPicks, rosters, weeklyStats);
    expect(data.budget).toBe(200);
    expect(data.picks.map((p) => [p.roster_id, p.amount])).toEqual([[2, 49], [1, 50]]);
  });

  it('handles a player with no games', () => {
    const data = buildDraftData(snakeDraft, picks, rosters, []);
    expect(data.weeks_scored).toBe(0);
    expect(data.picks[0]).toMatchObject({ weekly: [], games: 0, median_ppg: 0, total: 0 });
  });
});

describe('buildDraftData availability', () => {
  const draft: SleeperDraft = {
    draft_id: 'd1',
    season: '2026',
    type: 'snake',
    status: 'complete',
    settings: { teams: 1, rounds: 2 },
    slot_to_roster_id: { '1': 1 },
  };
  const pick = (pick_no: number, player_id: string, team: string): SleeperDraftPick => ({
    pick_no, round: pick_no, draft_slot: 1, player_id, picked_by: 'u1',
    metadata: { first_name: player_id, last_name: '', position: 'WR', team },
  });

  // Week 2 is KC's bye (no KC defense line); BUF plays every week
  const weeklyStats: Record<string, SleeperPlayerWeekStats>[] = [
    { KC: { gp: 1 }, BUF: { gp: 1 }, hurt: { gp: 1, pts_half_ppr: 25 }, kc: { gp: 1, pts_half_ppr: 10 } },
    { BUF: { gp: 1 } },
    { KC: { gp: 1 }, BUF: { gp: 1 }, kc: { gp: 1, pts_half_ppr: 14 } },
    { KC: { gp: 1 }, BUF: { gp: 1 }, kc: { gp: 1, pts_half_ppr: 12 } },
  ];

  it('counts injured weeks as zeros but excludes bye weeks', () => {
    const data = buildDraftData(draft, [pick(1, 'hurt', 'BUF'), pick(2, 'kc', 'KC')], [], weeklyStats);
    const [hurt, kc] = data.picks;

    // Played week 1 only, BUF had no bye: 25 over 4 available weeks
    expect(hurt).toMatchObject({ games: 1, median_ppg: 25, available_weeks: 4, ppw: 6.25 });
    // Played every non-bye week: the bye doesn't count against them
    expect(kc).toMatchObject({ games: 3, median_ppg: 12, available_weeks: 3, ppw: 12 });
  });

  it('counts a week played during the draft-time team\'s bye (traded player)', () => {
    const stats = weeklyStats.map((w, i) => (i === 1 ? { ...w, kc: { gp: 1, pts_half_ppr: 8 } } : w));
    const [kc] = buildDraftData(draft, [pick(1, 'kc', 'KC')], [], stats).picks;
    expect(kc).toMatchObject({ games: 4, available_weeks: 4, ppw: 11 });
  });

  it('skips bye detection for a team never seen playing', () => {
    const [p] = buildDraftData(draft, [pick(1, 'hurt', 'XYZ')], [], weeklyStats).picks;
    expect(p.available_weeks).toBe(4);
  });

  it('gives zero ppw when no weeks are scored', () => {
    const [p] = buildDraftData(draft, [pick(1, 'hurt', 'BUF')], [], []).picks;
    expect(p).toMatchObject({ available_weeks: 0, ppw: 0 });
  });
});

describe('withAvailability', () => {
  const base = (weeks_scored: number, picks: DraftPickData[]): DraftData => ({
    season: '2024', draft_id: 'd', type: 'auction', rounds: 1, teams: 1, budget: 200,
    weeks_scored, scoring: 'half_ppr', stat_note: '', picks,
  });

  it('assumes one bye for seasons scored through week 14+', () => {
    const data = withAvailability(base(17, [makePick({ games: 4, total: 40 })]));
    expect(data.picks[0]).toMatchObject({ available_weeks: 16, ppw: 2.5 });
  });

  it('assumes no bye before week 14', () => {
    const data = withAvailability(base(3, [makePick({ games: 2, total: 30 })]));
    expect(data.picks[0]).toMatchObject({ available_weeks: 3, ppw: 10 });
  });

  it('never assumes fewer available weeks than games played', () => {
    const data = withAvailability(base(17, [makePick({ games: 17, total: 170 })]));
    expect(data.picks[0]).toMatchObject({ available_weeks: 17, ppw: 10 });
  });

  it('leaves picks that already have availability untouched', () => {
    const input = base(17, [makePick({ available_weeks: 12, ppw: 4 })]);
    expect(withAvailability(input)).toBe(input);
  });
});
