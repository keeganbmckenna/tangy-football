/**
 * Draft board builders for snake and auction drafts.
 *
 * Per-player production is the median weekly half-PPR points over games played.
 * Median is used instead of mean because weekly fantasy scores are right-skewed:
 * a single 40-point spike inflates the mean and makes a boom-bust player look
 * better than the steady producer he was most weeks.
 */

export interface DraftPickData {
  pick_no: number;
  round: number | null;
  draft_slot: number | null;
  roster_id: number | null;
  player_id: string;
  name: string;
  position: string | null;
  nfl_team: string | null;
  /** Auction price in dollars; null for snake drafts */
  amount: number | null;
  weekly: number[];
  games: number;
  median_ppg: number;
  total: number;
}

export interface DraftData {
  season: string;
  draft_id: string;
  type: string;
  rounds: number;
  teams: number;
  budget: number | null;
  weeks_scored: number;
  scoring: string;
  stat_note: string;
  picks: DraftPickData[];
}

export interface SnakeBoardRow {
  round: number;
  /** Cells ordered by draft slot 1..teams; null when a slot has no pick */
  cells: (DraftPickData | null)[];
}

export interface AuctionBoardRound {
  round: number;
  picks: DraftPickData[];
}

export interface DraftTeamSummary {
  rosterId: number | null;
  picks: DraftPickData[];
  count: number;
  /** Sum of median weekly points across all picks: the "typical weekly haul" */
  haulMedian: number;
  /** Auction only: total dollars spent */
  spent: number;
  /** Auction only: dollars per typical weekly point (lower is better) */
  dollarsPerPoint: number | null;
  bestPick: DraftPickData | null;
}

/**
 * Median of a numeric array. Returns 0 for empty input.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Builds a snake draft board: one row per round, one column per draft slot.
 * Serpentine order is inherent in the data (each pick carries its draft_slot),
 * so no reversal logic is needed here.
 */
export function buildSnakeBoard(picks: DraftPickData[], teams: number): SnakeBoardRow[] {
  const rounds = Math.max(0, ...picks.map((p) => p.round ?? 0));
  const rows: SnakeBoardRow[] = [];
  for (let round = 1; round <= rounds; round++) {
    const cells: (DraftPickData | null)[] = Array.from({ length: teams }, () => null);
    for (const pick of picks) {
      if (pick.round === round && pick.draft_slot !== null && pick.draft_slot >= 1 && pick.draft_slot <= teams) {
        cells[pick.draft_slot - 1] = pick;
      }
    }
    rows.push({ round, cells });
  }
  return rows;
}

/**
 * Builds an auction draft board: picks in nomination order, grouped into
 * rounds of `teams` nominations each (matching how Sleeper runs auction drafts).
 */
export function buildAuctionBoard(picks: DraftPickData[], teams: number): AuctionBoardRound[] {
  const ordered = [...picks].sort((a, b) => a.pick_no - b.pick_no);
  const rounds: AuctionBoardRound[] = [];
  for (let i = 0; i < ordered.length; i += teams) {
    rounds.push({ round: Math.floor(i / teams) + 1, picks: ordered.slice(i, i + teams) });
  }
  return rounds;
}

/**
 * Per-team draft summary: picks, typical weekly haul (sum of median ppg),
 * auction spend, and the best pick by median weekly points.
 */
export function summarizeDraftByTeam(picks: DraftPickData[]): DraftTeamSummary[] {
  const byRoster = new Map<number | null, DraftPickData[]>();
  for (const pick of picks) {
    const list = byRoster.get(pick.roster_id) ?? [];
    list.push(pick);
    byRoster.set(pick.roster_id, list);
  }

  const summaries: DraftTeamSummary[] = [];
  for (const [rosterId, teamPicks] of byRoster) {
    const ordered = [...teamPicks].sort((a, b) => a.pick_no - b.pick_no);
    const haulMedian = ordered.reduce((sum, p) => sum + p.median_ppg, 0);
    const spent = ordered.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const bestPick = ordered.reduce<DraftPickData | null>(
      (best, p) => (!best || p.median_ppg > best.median_ppg ? p : best),
      null
    );
    summaries.push({
      rosterId,
      picks: ordered,
      count: ordered.length,
      haulMedian: Math.round(haulMedian * 100) / 100,
      spent,
      dollarsPerPoint: spent > 0 && haulMedian > 0 ? Math.round((spent / haulMedian) * 100) / 100 : null,
      bestPick,
    });
  }
  return summaries.sort((a, b) => b.haulMedian - a.haulMedian);
}

/** Tailwind classes for position badges */
export const POSITION_BADGE_CLASSES: Record<string, string> = {
  QB: 'bg-red-500/15 text-red-400',
  RB: 'bg-emerald-500/15 text-emerald-400',
  WR: 'bg-blue-500/15 text-blue-400',
  TE: 'bg-amber-500/15 text-amber-400',
  K: 'bg-purple-500/15 text-purple-400',
  DEF: 'bg-zinc-500/15 text-zinc-400',
};

export function positionBadgeClass(position: string | null): string {
  return (position && POSITION_BADGE_CLASSES[position]) || 'bg-zinc-500/15 text-zinc-400';
}
