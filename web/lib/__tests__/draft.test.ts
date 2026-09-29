import { describe, it, expect } from 'vitest';
import {
  median,
  buildDraftData,
  buildSnakeBoard,
  buildSnakeSlotTeams,
  buildAuctionBoardByTeam,
  summarizeDraftByTeam,
  positionBadgeClass,
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

  it('orders teams by typical weekly haul descending', () => {
    const picks = [
      makePick({ pick_no: 1, roster_id: 1, median_ppg: 5, amount: 50 }),
      makePick({ pick_no: 2, roster_id: 2, median_ppg: 20, amount: 40 }),
    ];
    const boards = buildAuctionBoardByTeam(picks);
    expect(boards.map((b) => b.rosterId)).toEqual([2, 1]);
    expect(boards[0].haulMedian).toBe(20);
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
    expect(summaries[0].haulMedian).toBe(28);
    expect(summaries[0].spent).toBe(55);
    expect(summaries[0].dollarsPerPoint).toBeCloseTo(55 / 28, 2);
    expect(summaries[0].bestPick?.name).toBe('Star');
    expect(summaries[1].bestPick?.name).toBe('Mid');
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
