/**
 * Trade analysis: what a trade does to both teams' weekly and season outlook,
 * and grades for past trades.
 *
 * Built on the playoff-odds models (playoffOdds.ts), where team strength comes
 * from the current roster's projected lineup and the team's points per game so
 * far. A trade changes the rosters, so each team's expected score moves by the
 * model's weight on its lineup change, like any other roster change:
 * - Season odds (fittedStrength): the trade's change in the lineup averaged over
 *   the remaining weeks, times the fitted lineup weight for this week of the
 *   season (about 0.3-0.5). On 28,899 teams in trades in other leagues
 *   (scripts/backtests/trades.py) a trade's projected change showed up at 0.43
 *   (95% 0.40-0.46), in line with that weight; the earlier 0.75 overstated trades.
 * - Weekly win odds (singleGameModel): that week's lineup change times the
 *   single-game lineup weight (about 0.8 next week, about 0.3 later), with that
 *   week's spread; it beat the earlier weekly odds out of sample (single_games.py).
 * The earlier model (75% of the lineup change, 0.8x / 2x spreads) stays as the
 * fallback when there are no projections (earlierTradeModel).
 */

import {
  bestLineup,
  PROJECTION_WEIGHT,
  simulatePlayoffOdds,
  type GameModel,
  type OddsResult,
  type OddsTeam,
  type PlayoffFormat,
  type RemainingGame,
} from './playoffOdds';
import type { SleeperMatchup, SleeperTransaction } from '../types';

// ---------------------------------------------------------------------------
// Inputs

/** Player projections and rosters a trade is evaluated against */
export interface TradeInputs {
  /** Weeks with projections: the remaining regular season and the playoffs */
  weeks: number[];
  /** playerId -> week -> expected points: the odds model's player value (0 on a bye or when out) */
  projections: Record<string, Record<number, number>>;
  positions: Record<string, string>;
  /** rosterId -> player IDs */
  rosters: Record<number, string[]>;
  /** rosterId -> players in IR slots (on the roster but not counted toward its size) */
  reserve?: Record<number, string[]>;
  /** Best available free agents, for refilling roster spots a trade opens */
  freeAgents: string[];
  rosterPositions: string[];
  lastScoredWeek: number;
}

/** Players moving to and from one team */
export interface TradeMove {
  rosterId: number;
  sends: string[];
  receives: string[];
}

/** A team's roster after a trade, including drops and pickups the trade forces */
export interface RosterChange {
  rosterId: number;
  before: string[];
  after: string[];
  /** Dropped to make room for extra incoming players */
  dropped: string[];
  /** Free agents picked up to fill spots the trade opened */
  added: string[];
}

const weekProjections = (inputs: TradeInputs, week: number, players: string[]) => {
  const out: Record<string, { position: string; points: number }> = {};
  for (const p of players) {
    const position = inputs.positions[p];
    if (position) out[p] = { position, points: inputs.projections[p]?.[week] ?? 0 };
  }
  return out;
};

/** Projected best-lineup points for each projection week */
export function lineupByWeek(inputs: TradeInputs, players: string[]): Record<number, number> {
  return Object.fromEntries(
    inputs.weeks.map((w) => [w, bestLineup(players, weekProjections(inputs, w, players), inputs.rosterPositions).total])
  );
}

const seasonLineupPoints = (inputs: TradeInputs, players: string[]) =>
  Object.values(lineupByWeek(inputs, players)).reduce((s, v) => s + v, 0);

/**
 * A team's roster after a trade. Receiving more players than it sends forces
 * drops: the players whose loss costs the least projected lineup points.
 * Sending more than it receives opens spots, filled with the free agents that
 * add the most (other than any in unavailable, e.g. the other team's pickups).
 */
export function rosterAfterTrade(inputs: TradeInputs, move: TradeMove, unavailable: string[] = []): RosterChange {
  const before = inputs.rosters[move.rosterId] ?? [];
  const sends = new Set(move.sends);
  let after = [...before.filter((p) => !sends.has(p)), ...move.receives.filter((p) => !before.includes(p))];
  // Players in IR slots stay on the roster without counting toward its size
  const reserved = new Set((inputs.reserve?.[move.rosterId] ?? []).filter((p) => !sends.has(p)));
  const active = (players: string[]) => players.filter((p) => !reserved.has(p));
  const activeBefore = before.filter((p) => !(inputs.reserve?.[move.rosterId] ?? []).includes(p)).length;
  const capacity = Math.max(inputs.rosterPositions.length, activeBefore);
  const dropped: string[] = [];
  const added: string[] = [];

  const ownPoints = (p: string) => inputs.weeks.reduce((s, w) => s + (inputs.projections[p]?.[w] ?? 0), 0);
  while (active(after).length > capacity) {
    // Ties (usually bench players who never start) go to dropping the lowest-projected one
    let best: { id: string; points: number; own: number } | null = null;
    for (const p of active(after)) {
      const points = seasonLineupPoints(inputs, after.filter((x) => x !== p));
      const own = ownPoints(p);
      if (!best || points > best.points + 1e-9 || (Math.abs(points - best.points) <= 1e-9 && own < best.own)) {
        best = { id: p, points, own };
      }
    }
    after = after.filter((p) => p !== best!.id);
    dropped.push(best!.id);
  }

  const target = Math.min(activeBefore, inputs.rosterPositions.length);
  while (active(after).length < target) {
    const taken = new Set([...after, ...added, ...move.sends, ...unavailable]);
    let best: { id: string; points: number } | null = null;
    for (const p of inputs.freeAgents) {
      if (taken.has(p)) continue;
      const points = seasonLineupPoints(inputs, [...after, p]);
      if (!best || points > best.points) best = { id: p, points };
    }
    if (!best) break;
    after = [...after, best.id];
    added.push(best.id);
  }

  return { rosterId: move.rosterId, before, after, dropped, added };
}

// ---------------------------------------------------------------------------
// Trade effect

type Means = Record<number, Record<number, number>>;

/** What the trade tools need from the odds models (the trade-data route builds it) */
export interface TradeModel {
  /** Season simulation: expected score per week, week-to-week spread, persistent team spread, weight on a trade's average lineup change */
  season: { meanByWeek: Means; spread: number; teamSpread: number; lineupWeight: number };
  /** Single games: expected margin per week, spread per week, weight on that week's lineup change */
  games: GameModel;
}

/** The earlier trade model (75% of each week's lineup change, 0.8x / 2x spreads), for when there are no projections */
export function earlierTradeModel(meanByWeek: Means, spread: number, lastScoredWeek: number, regularWeeks: number[]): TradeModel {
  const weeks = regularWeeks.filter((w) => meanByWeek[w]);
  return {
    season: { meanByWeek, spread, teamSpread: 0, lineupWeight: PROJECTION_WEIGHT },
    games: {
      meanByWeek: Object.fromEntries(weeks.map((w) => [w, meanByWeek[w]])),
      spreadByWeek: Object.fromEntries(weeks.map((w) => [w, winOddsSpreadScale(w - lastScoredWeek) * spread])),
      lineupWeightByWeek: Object.fromEntries(weeks.map((w) => [w, PROJECTION_WEIGHT])),
    },
  };
}

/**
 * The models after a trade: in the season model each changed team's expected score moves by the
 * lineup weight times its lineup change averaged over the remaining regular-season weeks (the
 * weeks the single-game model covers), in every week; in the single-game model by that week's
 * weight times that week's change.
 */
export function meansAfterTrade(
  model: TradeModel,
  inputs: TradeInputs,
  changes: RosterChange[]
): { model: TradeModel; lineupDelta: Record<number, Record<number, number>> } {
  const copy = (m: Means): Means => Object.fromEntries(Object.entries(m).map(([w, v]) => [Number(w), { ...v }]));
  const season = copy(model.season.meanByWeek);
  const games = copy(model.games.meanByWeek);
  const regular = Object.keys(games).map(Number);
  const lineupDelta: Record<number, Record<number, number>> = {};
  for (const c of changes) {
    const was = lineupByWeek(inputs, c.before);
    const now = lineupByWeek(inputs, c.after);
    lineupDelta[c.rosterId] = Object.fromEntries(inputs.weeks.map((w) => [w, now[w] - was[w]]));
    const seasonWeeks = regular.filter((w) => w in lineupDelta[c.rosterId]);
    const avg = seasonWeeks.length ? seasonWeeks.reduce((s, w) => s + lineupDelta[c.rosterId][w], 0) / seasonWeeks.length : 0;
    for (const w of Object.keys(season).map(Number)) {
      if (season[w][c.rosterId] !== undefined) season[w][c.rosterId] += model.season.lineupWeight * avg;
    }
    for (const w of regular) {
      if (games[w][c.rosterId] !== undefined) games[w][c.rosterId] += model.games.lineupWeightByWeek[w] * (lineupDelta[c.rosterId][w] ?? 0);
    }
  }
  return { model: { season: { ...model.season, meanByWeek: season }, games: { ...model.games, meanByWeek: games } }, lineupDelta };
}

// ---------------------------------------------------------------------------
// Weekly win odds

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7) */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** The earlier model's spread multiplier for one game's win odds, by weeks ahead (earlierTradeModel) */
export const winOddsSpreadScale = (weeksAhead: number) => (weeksAhead <= 1 ? 0.8 : 2);

/** Chance a team with this expected score (or margin) beats one with oppMean, at that week's spread */
export function weeklyWinProbability(mean: number, oppMean: number, spread: number): number {
  return normalCdf((mean - oppMean) / (spread * Math.SQRT2));
}

/** One remaining game's win odds for a team under the single-game model */
const gameWinProbability = (games: GameModel, week: number, rosterId: number, opponent: number) =>
  weeklyWinProbability(games.meanByWeek[week]?.[rosterId] ?? 0, games.meanByWeek[week]?.[opponent] ?? 0, games.spreadByWeek[week] ?? 25);

/** Expected wins over a team's remaining games: the sum of its single-game win odds */
export function expectedWins(rosterId: number, remaining: RemainingGame[], model: TradeModel): number {
  return remaining
    .filter((g) => g.a === rosterId || g.b === rosterId)
    .reduce((s, g) => s + gameWinProbability(model.games, g.week, rosterId, g.a === rosterId ? g.b : g.a), 0);
}

export interface WeekOutlook {
  week: number;
  opponent: number;
  winProbability: number;
}

/** A team's win odds in each remaining regular-season game */
export function weeklyOutlook(rosterId: number, remaining: RemainingGame[], model: TradeModel): WeekOutlook[] {
  return remaining
    .filter((g) => g.a === rosterId || g.b === rosterId)
    .sort((x, y) => x.week - y.week)
    .map((g) => {
      const opponent = g.a === rosterId ? g.b : g.a;
      return { week: g.week, opponent, winProbability: gameWinProbability(model.games, g.week, rosterId, opponent) };
    });
}

// ---------------------------------------------------------------------------
// Season odds

export interface TradeOdds {
  before: OddsResult;
  after: OddsResult;
}

/**
 * Season odds without and with a trade. Both runs use the same random draws,
 * so the difference comes from the trade rather than simulation noise.
 */
export function tradeSeasonOdds(
  teams: OddsTeam[],
  remaining: RemainingGame[],
  format: PlayoffFormat,
  before: TradeModel,
  after: TradeModel,
  playoffWeekStart: number,
  toiletBowl: boolean,
  sims = 20000,
  seed = 2026
): TradeOdds {
  const run = (m: TradeModel) =>
    simulatePlayoffOdds(teams, remaining, format, m.season.meanByWeek, m.season.spread, sims, seed, playoffWeekStart, toiletBowl, m.season.teamSpread);
  return { before: run(before), after: run(after) };
}

// ---------------------------------------------------------------------------
// Past trades

export interface TradeSideRecord {
  rosterId: number;
  receives: string[];
  sends: string[];
  /** Draft picks received, e.g. "2025 round 3" */
  picks: string[];
  /** FAAB received (net of FAAB sent) */
  faab: number;
}

export interface TradeRecord {
  id: string;
  week: number;
  created: number;
  sides: TradeSideRecord[];
}

/** Completed trades from a season's transactions, oldest first */
export function parseTrades(transactions: SleeperTransaction[]): TradeRecord[] {
  return transactions
    .filter((t) => t.type === 'trade' && t.status === 'complete')
    .map((t) => ({
      id: t.transaction_id,
      week: t.leg,
      created: t.created ?? 0,
      sides: t.roster_ids.map((rosterId) => ({
        rosterId,
        receives: Object.entries(t.adds ?? {}).filter(([, r]) => r === rosterId).map(([p]) => p),
        sends: Object.entries(t.drops ?? {}).filter(([, r]) => r === rosterId).map(([p]) => p),
        picks: (t.draft_picks ?? [])
          .filter((d) => d.owner_id === rosterId && d.previous_owner_id !== rosterId)
          .map((d) => `${d.season} round ${d.round}`),
        faab: (t.waiver_budget ?? []).reduce(
          (s, b) => s + (b.receiver === rosterId ? b.amount : 0) - (b.sender === rosterId ? b.amount : 0),
          0
        ),
      })),
    }))
    .sort((a, b) => a.week - b.week || a.created - b.created);
}

/** Points the given players scored while in a team's starting lineup over a span of weeks */
export function starterPoints(
  players: string[],
  rosterId: number,
  matchupsByWeek: Record<number, SleeperMatchup[]>,
  fromWeek: number,
  toWeek: number
): { points: number; starts: number; byPlayer: Record<string, number> } {
  let points = 0;
  let starts = 0;
  const byPlayer: Record<string, number> = {};
  const wanted = new Set(players);
  for (let w = fromWeek; w <= toWeek; w++) {
    const m = matchupsByWeek[w]?.find((x) => x.roster_id === rosterId);
    if (!m) continue;
    for (const p of m.starters ?? []) {
      if (!wanted.has(p)) continue;
      starts++;
      points += m.players_points?.[p] ?? 0;
      byPlayer[p] = (byPlayer[p] ?? 0) + (m.players_points?.[p] ?? 0);
    }
  }
  for (const p of Object.keys(byPlayer)) byPlayer[p] = Math.round(byPlayer[p] * 100) / 100;
  return { points: Math.round(points * 100) / 100, starts, byPlayer };
}

// ---------------------------------------------------------------------------
// API shapes

export interface TradePlayerInfo {
  id: string;
  name: string;
  position: string;
  team: string | null;
  injury: string | null;
  /** Average expected points per remaining regular-season week (byes count as 0): the odds model's player value */
  expectedPerWeek: number;
  /** Points per game this season (null if he hasn't played) */
  seasonPerGame: number | null;
  /** FantasyCalc redraft value (null if FantasyCalc doesn't value the player) */
  value: number | null;
  /** His NFL team's bye week if it's still to come in the regular season */
  byeWeek: number | null;
}

/** /api/trade-data: everything the analyzer needs, evaluated in the browser */
export interface TradeDataResponse {
  /** Whether trades are still allowed (regular season in progress, before the deadline) */
  open: boolean;
  season: string;
  currentWeek: number;
  /** 0 when the league has no deadline */
  tradeDeadline: number;
  regularSeasonEnd: number;
  playoffWeekStart: number;
  format: PlayoffFormat;
  hasToiletBowl: boolean;
  teams: OddsTeam[];
  remaining: RemainingGame[];
  /** The earlier model's expected scores and spread, logged for the 2026 evaluation (single games, P2) */
  meanByWeek: Record<number, Record<number, number>>;
  spread: number;
  /** What the tools use */
  model: TradeModel;
  inputs: TradeInputs;
  players: Record<string, TradePlayerInfo>;
  /** FantasyCalc values loaded */
  marketValues: boolean;
  generatedAt: string;
}

export interface TradeHistorySide extends TradeSideRecord {
  /** Odds the week of the trade, without and with it (null if it couldn't be simulated) */
  atTime: {
    before: { playoffs: number; champion: number | null; lastPlace: number | null };
    after: { playoffs: number; champion: number | null; lastPlace: number | null };
    /** Projected lineup change per week, raw (if nothing else changed) */
    lineupPerWeek: number;
  } | null;
  /** Points the received players scored in this team's starting lineup afterward */
  /** Points the players it received scored in its starting lineup (byPlayer: each one's; absent in older files) */
  hindsight: { points: number; starts: number; byPlayer?: Record<string, number> };
  /** Final regular-season seed (null while the season is in progress) */
  finalSeed: number | null;
}

export interface TradeHistoryEntry {
  id: string;
  /** Week Sleeper processed the trade in */
  week: number;
  /** First week the trade counted for (the next week if it went through after that week's games) */
  effectiveWeek: number;
  sides: TradeHistorySide[];
}

/** /api/trades/[season] (or /data/trades/{season}.json for completed seasons) */
export interface TradeHistoryResponse {
  season: string;
  playoffTeams: number;
  /** Last week the hindsight points cover */
  throughWeek: number;
  complete: boolean;
  /** player ID -> name and position */
  players: Record<string, { name: string; position: string }>;
  trades: TradeHistoryEntry[];
  generatedAt: string;
}
