/**
 * Draft board builders for snake and auction drafts.
 *
 * Each pick carries two production numbers:
 * - median_ppg: median weekly half-PPR points over games played, "how good was
 *   he when he played". Median rather than mean because weekly scores are
 *   right-skewed: one 40-point spike would make a boom-bust player look better
 *   than the steady producer he was most weeks.
 * - ppw: total points / available weeks (weeks elapsed minus his team's byes),
 *   "what did this pick give the team each week". Missed games count as zeros,
 *   so a star who got hurt in week 4 grades as the bust he was. This is a mean
 *   on purpose: each missed week should cost its share, and a median over a
 *   mostly-zero season collapses to 0 regardless of how he played.
 *
 * Teams are graded by their draft core (buildDraftCore): the players they
 * invested in for each starting slot, i.e. did the draft's big bets pay off.
 * Kickers and defenses aren't graded: they're often left undrafted and
 * streamed off waivers, which says nothing about the draft.
 */

import type { SleeperDraft, SleeperDraftPick, SleeperPlayerWeekStats, SleeperRoster } from '../types';

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
  /** Weeks elapsed minus bye weeks; absent in files built before it existed */
  available_weeks?: number;
  /** Points per available week (total / available_weeks) */
  ppw?: number;
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

export interface AuctionTeamBoard {
  rosterId: number | null;
  /** Picks sorted by auction price, highest first */
  picks: DraftPickData[];
  /** Sum of points per available week: what the class delivered each week */
  haul: number;
  /** Sum of median weekly points when playing: the class at full health */
  haulHealthy: number;
  /** Total dollars spent */
  spent: number;
  /** Core/wk (see buildDraftCore); null when not provided */
  core: number | null;
}

export interface DraftTeamSummary {
  rosterId: number | null;
  picks: DraftPickData[];
  count: number;
  /** Sum of points per available week across all picks */
  haul: number;
  /** Sum of median weekly points when playing across all picks */
  haulHealthy: number;
  /** Core/wk (see buildDraftCore); null when not provided */
  core: number | null;
  /** Auction only: total dollars spent */
  spent: number;
  /** Auction only: dollars per Core/wk point, or per haul point without it (lower is better) */
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Points per available week for a pick, from the pick's own fields */
export function pointsPerAvailableWeek(total: number, availableWeeks: number): number {
  return availableWeeks > 0 ? round2(total / availableWeeks) : 0;
}

/**
 * Fills available_weeks/ppw on picks from files built before those fields
 * existed. NFL byes fall in weeks 5-14 and every team has exactly one, so a
 * season scored through week 14+ loses one week per player; earlier than that
 * the bye may not have happened yet, so none is assumed. Exact for completed
 * seasons except players traded across bye weeks.
 */
export function withAvailability(data: DraftData): DraftData {
  if (data.picks.every((p) => p.available_weeks !== undefined && p.ppw !== undefined)) return data;
  const assumedAvailable = data.weeks_scored - (data.weeks_scored >= 14 ? 1 : 0);
  return {
    ...data,
    picks: data.picks.map((p) => {
      if (p.available_weeks !== undefined && p.ppw !== undefined) return p;
      const available = Math.max(assumedAvailable, p.games);
      return { ...p, available_weeks: available, ppw: pointsPerAvailableWeek(p.total, available) };
    }),
  };
}

/** Points per available week, tolerating picks not run through withAvailability */
export function ppwOf(pick: DraftPickData): number {
  return pick.ppw ?? pick.median_ppg;
}

/**
 * Builds a season's DraftData from raw Sleeper responses. Mirrors
 * scripts/build_draft_data.py so live and pre-built seasons have the same shape.
 *
 * @param weeklyStats one stats map per scored week (index 0 = week 1)
 */
export function buildDraftData(
  draft: SleeperDraft,
  picks: SleeperDraftPick[],
  rosters: SleeperRoster[],
  weeklyStats: Record<string, SleeperPlayerWeekStats>[]
): DraftData {
  const type = draft.type || 'snake';
  const userToRoster = new Map(rosters.map((r) => [r.owner_id, r.roster_id]));
  const slotToRoster = new Map(
    Object.entries(draft.slot_to_roster_id ?? {}).map(([slot, rosterId]) => [Number(slot), rosterId])
  );

  // A team is on bye (or its game was cancelled) in a week its defense didn't
  // play. Defense stats are keyed by team abbreviation. Teams never seen
  // playing (unknown abbreviation) get no bye detection: every week counts.
  const teamPlayed = (stats: Record<string, SleeperPlayerWeekStats>, team: string) =>
    (stats[team]?.gp ?? 0) >= 1;
  const knownTeams = new Set<string>();
  for (const stats of weeklyStats) {
    for (const [id, s] of Object.entries(stats)) {
      if (/^[A-Z]{2,3}$/.test(id) && (s.gp ?? 0) >= 1) knownTeams.add(id);
    }
  }

  const out = [...picks]
    .sort((a, b) => (a.pick_no ?? 0) - (b.pick_no ?? 0))
    .map((p): DraftPickData => {
      const meta = p.metadata ?? {};
      const pid = p.player_id ?? '';
      // Games played only (gp >= 1): bye weeks and inactive weeks don't count as zeros
      const weekly: number[] = [];
      let availableWeeks = 0;
      const team = meta.team ?? '';
      for (const stats of weeklyStats) {
        const s = pid ? stats[pid] : undefined;
        const played = !!s && (s.gp ?? 0) >= 1;
        if (played) weekly.push(round2(Number(s.pts_half_ppr ?? 0)));
        // A week counts unless he sat it out because his (draft-time) team was
        // on bye. Playing always counts, which covers mid-season trades.
        const onBye = knownTeams.has(team) && !teamPlayed(stats, team);
        if (played || !onBye) availableWeeks++;
      }
      const total = round2(weekly.reduce((sum, v) => sum + v, 0));
      const rosterId =
        type === 'auction'
          ? userToRoster.get(p.picked_by ?? '') ?? null
          : slotToRoster.get(p.draft_slot ?? -1) ?? null;
      const name = `${meta.first_name ?? ''} ${meta.last_name ?? ''}`.trim() || pid;
      const amount = meta.amount === undefined || meta.amount === '' ? null : parseInt(meta.amount, 10);

      return {
        pick_no: p.pick_no,
        round: p.round,
        draft_slot: p.draft_slot,
        roster_id: rosterId,
        player_id: pid,
        name,
        position: meta.position ?? null,
        nfl_team: meta.team ?? null,
        amount: Number.isNaN(amount) ? null : amount,
        weekly,
        games: weekly.length,
        median_ppg: round2(median(weekly)),
        total,
        available_weeks: availableWeeks,
        ppw: pointsPerAvailableWeek(total, availableWeeks),
      };
    });

  const budget = draft.settings?.budget;
  return {
    season: draft.season,
    draft_id: draft.draft_id,
    type,
    rounds: draft.settings?.rounds ?? 0,
    teams: draft.settings?.teams ?? 12,
    budget: budget ? Math.trunc(budget) : null,
    weeks_scored: weeklyStats.length,
    scoring: 'half_ppr',
    stat_note:
      'median_ppg: median weekly half-PPR points over games played (gp >= 1); ' +
      'ppw: total points per available week (weeks elapsed minus byes)',
    picks: out,
  };
}

/** Positions each graded starting slot accepts. K, DEF, bench, IR and IDP slots aren't graded. */
export const LINEUP_SLOT_POSITIONS: Record<string, string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

/** Used only if the league's roster_positions are unavailable */
export const DEFAULT_ROSTER_POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'];

export interface GradedSlot {
  /** Sleeper slot name, e.g. 'RB' or 'FLEX' */
  slot: string;
  /** Positions the slot accepts */
  eligible: string[];
}

/**
 * The league's graded starting slots (QB/RB/WR/TE and flex; no K/DEF), in fill
 * order: dedicated slots first, then flex from most to least restrictive, so
 * a flex slot never takes a player a dedicated slot needs.
 */
export function gradedSlots(rosterPositions?: string[] | null): GradedSlot[] {
  const positions = rosterPositions && rosterPositions.length > 0 ? rosterPositions : DEFAULT_ROSTER_POSITIONS;
  return positions
    .filter((slot) => slot in LINEUP_SLOT_POSITIONS)
    .map((slot) => ({ slot, eligible: LINEUP_SLOT_POSITIONS[slot] }))
    .sort((a, b) => a.eligible.length - b.eligible.length);
}

const SLOT_LABELS: Record<string, string> = {
  FLEX: 'FLEX',
  SUPER_FLEX: 'SF',
  REC_FLEX: 'WR/TE',
  WRRB_FLEX: 'RB/WR',
};

export interface CoreSlot {
  /** Column label, e.g. 'QB', 'RB1', 'FLEX' */
  label: string;
  pick: DraftPickData | null;
}

export interface TeamCore {
  rosterId: number | null;
  /** One entry per graded starting slot, in column order */
  slots: CoreSlot[];
  /** Sum of the core players' points per available week */
  total: number;
}

/**
 * Each team's intended starters: the players it invested in for each starting
 * slot. In an auction that's the most expensive at the position, in a snake
 * draft the earliest pick. Dedicated slots fill first (QB = top QB, RB1/RB2 =
 * top two RBs, ...), then flex slots take the top remaining eligible player.
 * Graded by ppw, so injuries count against the pick and byes don't.
 */
export function buildDraftCore(data: DraftData, rosterPositions?: string[] | null): {
  labels: string[];
  teams: TeamCore[];
} {
  const slots = gradedSlots(rosterPositions);
  const counts = new Map<string, number>();
  for (const { slot } of slots) counts.set(slot, (counts.get(slot) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = slots.map(({ slot }) => {
    const n = (seen.get(slot) ?? 0) + 1;
    seen.set(slot, n);
    const base = SLOT_LABELS[slot] ?? slot;
    return (counts.get(slot) ?? 0) > 1 ? `${base}${n}` : base;
  });

  // Most invested first: auction price, then draft order
  const invested = (a: DraftPickData, b: DraftPickData) =>
    data.type === 'auction' ? (b.amount ?? 0) - (a.amount ?? 0) || a.pick_no - b.pick_no : a.pick_no - b.pick_no;

  const byRoster = new Map<number | null, DraftPickData[]>();
  for (const pick of data.picks) {
    const list = byRoster.get(pick.roster_id) ?? [];
    if (isGradedPosition(pick.position)) list.push(pick);
    byRoster.set(pick.roster_id, list);
  }

  const teams: TeamCore[] = [];
  for (const [rosterId, teamPicks] of byRoster) {
    const ranked = [...teamPicks].sort(invested);
    const used = new Set<number>();
    const filled = slots.map(({ eligible }, i): CoreSlot => {
      const pick = ranked.find((p) => !used.has(p.pick_no) && eligible.includes(p.position ?? '')) ?? null;
      if (pick) used.add(pick.pick_no);
      return { label: labels[i], pick };
    });
    const total = round2(filled.reduce((sum, c) => sum + (c.pick ? ppwOf(c.pick) : 0), 0));
    teams.push({ rosterId, slots: filled, total });
  }
  teams.sort((a, b) => b.total - a.total);
  return { labels, teams };
}

export function isGradedPosition(position: string | null): boolean {
  return position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE';
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
 * Builds an auction draft board grouped by team: each team's drafted roster,
 * sorted by auction price (big-money picks first). Teams are ordered by
 * Core/wk (or haul without it), matching the Draft Results summary.
 */
export function buildAuctionBoardByTeam(picks: DraftPickData[], core?: TeamCore[]): AuctionTeamBoard[] {
  const coreTotals = new Map(core?.map((t) => [t.rosterId, t.total]));
  const byRoster = new Map<number | null, DraftPickData[]>();
  for (const pick of picks) {
    const list = byRoster.get(pick.roster_id) ?? [];
    list.push(pick);
    byRoster.set(pick.roster_id, list);
  }

  const boards: AuctionTeamBoard[] = [];
  for (const [rosterId, teamPicks] of byRoster) {
    const ordered = [...teamPicks].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || a.pick_no - b.pick_no);
    boards.push({
      rosterId,
      picks: ordered,
      haul: ordered.reduce((sum, p) => sum + ppwOf(p), 0),
      haulHealthy: ordered.reduce((sum, p) => sum + p.median_ppg, 0),
      spent: ordered.reduce((sum, p) => sum + (p.amount ?? 0), 0),
      core: core ? coreTotals.get(rosterId) ?? 0 : null,
    });
  }
  return boards.sort((a, b) => (b.core ?? b.haul) - (a.core ?? a.haul));
}

/**
 * Maps draft slot (1..teams) to the roster that holds it, derived from the
 * round-1 picks. With no draft-pick trades a slot is always held by the same
 * roster, so each column of the snake board belongs to one team.
 */
export function buildSnakeSlotTeams(picks: DraftPickData[], teams: number): (number | null)[] {
  const slots: (number | null)[] = Array.from({ length: teams }, () => null);
  for (const pick of picks) {
    if (pick.round === 1 && pick.draft_slot !== null && pick.draft_slot >= 1 && pick.draft_slot <= teams) {
      slots[pick.draft_slot - 1] = pick.roster_id;
    }
  }
  return slots;
}

/**
 * Per-team draft summary: picks, weekly haul (sum of points per available
 * week), the at-full-health haul (sum of median ppg), auction spend, and the
 * best QB/RB/WR/TE pick by points per available week. With core totals,
 * teams are ranked by Core/wk and $/pt is per Core/wk point.
 */
export function summarizeDraftByTeam(picks: DraftPickData[], core?: TeamCore[]): DraftTeamSummary[] {
  const coreTotals = new Map(core?.map((t) => [t.rosterId, t.total]));
  const byRoster = new Map<number | null, DraftPickData[]>();
  for (const pick of picks) {
    const list = byRoster.get(pick.roster_id) ?? [];
    list.push(pick);
    byRoster.set(pick.roster_id, list);
  }

  const summaries: DraftTeamSummary[] = [];
  for (const [rosterId, teamPicks] of byRoster) {
    const ordered = [...teamPicks].sort((a, b) => a.pick_no - b.pick_no);
    const haul = ordered.reduce((sum, p) => sum + ppwOf(p), 0);
    const haulHealthy = ordered.reduce((sum, p) => sum + p.median_ppg, 0);
    const spent = ordered.reduce((sum, p) => sum + (p.amount ?? 0), 0);
    const bestPick = ordered
      .filter((p) => isGradedPosition(p.position))
      .reduce<DraftPickData | null>((best, p) => (!best || ppwOf(p) > ppwOf(best) ? p : best), null);
    const coreTotal = core ? coreTotals.get(rosterId) ?? 0 : null;
    const graded = coreTotal ?? haul;
    summaries.push({
      rosterId,
      picks: ordered,
      count: ordered.length,
      haul: round2(haul),
      haulHealthy: round2(haulHealthy),
      core: coreTotal,
      spent,
      dollarsPerPoint: spent > 0 && graded > 0 ? round2(spent / graded) : null,
      bestPick,
    });
  }
  return summaries.sort((a, b) => (b.core ?? b.haul) - (a.core ?? a.haul));
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
