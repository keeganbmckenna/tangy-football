import { describe, it, expect } from 'vitest';
import {
  median,
  buildSnakeBoard,
  buildAuctionBoard,
  summarizeDraftByTeam,
  positionBadgeClass,
  type DraftPickData,
} from '../analyze/draft';

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

describe('buildAuctionBoard', () => {
  it('groups nomination-order picks into rounds of `teams`', () => {
    const picks = [1, 2, 3, 4, 5].map((n) => makePick({ pick_no: n }));
    const rounds = buildAuctionBoard(picks, 2);
    expect(rounds).toHaveLength(3);
    expect(rounds[0].picks.map((p) => p.pick_no)).toEqual([1, 2]);
    expect(rounds[2].picks.map((p) => p.pick_no)).toEqual([5]);
  });

  it('sorts by pick_no regardless of input order', () => {
    const picks = [makePick({ pick_no: 3 }), makePick({ pick_no: 1 }), makePick({ pick_no: 2 })];
    const rounds = buildAuctionBoard(picks, 12);
    expect(rounds[0].picks.map((p) => p.pick_no)).toEqual([1, 2, 3]);
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
