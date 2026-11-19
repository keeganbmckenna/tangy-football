/**
 * Waiver finder: for one team, which free agent pickups help most, either over
 * the rest of the season or in one chosen week (e.g. to cover a bye).
 *
 * Each candidate is the best free agents at every position (kickers and
 * defenses included). Adding one forces a drop when the roster is full: the
 * player whose loss costs the rest-of-season lineup least, so a one-week fill
 * never costs more later than it has to. Candidates are ranked on expected
 * wins (season) or that week's win odds (week); the best are then simulated
 * with the playoff model on the same random draws as without the move, so
 * every result also shows its effect on the season.
 *
 * Two or three pickups at once: sets built from the best single pickups, each
 * with the drops it needs together, and kept only when every pickup in it adds
 * something over the set without it.
 */

import { simulatePlayoffOdds, type OddsResult } from './playoffOdds';
import {
  expectedWins,
  lineupByWeek,
  meansAfterTrade,
  type RosterChange,
  type TradeModel,
  rosterAfterTrade,
  gameWinProbability,
  withPickups,
  type TradeDataResponse,
} from './trade';

/** 'season' for the rest of the season, or a remaining week number */
export type WaiverTarget = 'season' | number;

export interface WaiverOptions {
  target: WaiverTarget;
  /** Only free agents at these positions (all when empty or missing) */
  positions?: string[];
  /** Skip free agents listed out, doubtful, on IR or suspended (questionable ones stay) */
  healthyOnly?: boolean;
  /** Roster players never dropped for a pickup */
  keep?: string[];
  /** Pickups at once (1 to 3; default 1) */
  adds?: number;
  sims?: number;
  seed?: number;
}

export interface WaiverOdds {
  playoffs: number;
  champion: number | null;
  lastPlace: number | null;
  expectedWins: number;
}

export interface WaiverPickup {
  /** The free agents to add (one, or a set picked up together) */
  add: string[];
  /** Who to drop (empty if the roster has an open spot) */
  drop: string[];
  /** Expected lineup points per remaining regular-season week, before -> after */
  lineup: [number, number];
  /** The target week's game (null for the rest of the season) */
  week: { week: number; opponent: number; winBefore: number; winAfter: number; lineupBefore: number; lineupAfter: number } | null;
  odds: [WaiverOdds, WaiverOdds];
}

export interface WaiverProgress {
  stage: 'scoring' | 'simulating' | 'done';
  done: number;
  total: number;
}

const FINALISTS = 12;
/** Single pickups that sets are built from, and the sets of one size extended to the next */
const POOL = 16;
const BEAM = 12;
/** Each pickup in a set must add at least this much (expected wins, or win odds in a week) */
const MIN_EACH = 0.002;
const SHOWN = 8;
/** At most this many results per position, so near-identical kickers don't crowd out the rest */
const PER_POSITION = 3;

/** Injury statuses that mean he won't play soon (questionable players usually do) */
export const unavailable = (injury: string | null | undefined) => !!injury && !/^q/i.test(injury);

const oddsFor = (o: OddsResult, id: number): WaiverOdds => ({
  playoffs: o.teams[id].playoffs,
  champion: o.teams[id].champion,
  lastPlace: o.teams[id].lastPlace,
  expectedWins: o.teams[id].expectedWins,
});

export function findPickups(
  data: TradeDataResponse,
  me: number,
  options: WaiverOptions,
  onProgress: (p: WaiverProgress) => void = () => {}
): WaiverPickup[] {
  const { inputs } = data;
  const sims = options.sims ?? 5000;
  const seed = options.seed ?? 2026;
  const size = Math.max(1, Math.min(3, Math.round(options.adds ?? 1)));
  const regular = inputs.weeks.filter((w) => w <= data.regularSeasonEnd);
  const avg = (byWeek: Record<number, number>) => regular.reduce((s, w) => s + byWeek[w], 0) / Math.max(regular.length, 1);
  const target = options.target;
  const game = typeof target === 'number' ? data.remaining.find((g) => g.week === target && (g.a === me || g.b === me)) : undefined;
  const opponent = game ? (game.a === me ? game.b : game.a) : null;
  const winOdds = (m: TradeModel) =>
    game && opponent !== null
      ? gameWinProbability(m, game.week, me, opponent)
      : 0;

  const baseWins = expectedWins(me, data.remaining, data.model);
  const baseWeekWin = winOdds(data.model);
  const baseLineup = lineupByWeek(inputs, inputs.rosters[me] ?? []);

  type Scored = { add: string[]; drop: string[]; means: TradeModel; score: number; lineup: [number, number]; weekLineup: [number, number]; weekWin: number };
  const memo = new Map<string, Scored | null>();
  const keyOf = (adds: string[]) => [...adds].sort().join(',');
  /** One set of pickups, with the drops it needs together (null if a pickup would be the one dropped) */
  const evaluate = (adds: string[]): Scored | null => {
    const key = keyOf(adds);
    if (memo.has(key)) return memo.get(key)!;
    const change = rosterAfterTrade(inputs, { rosterId: me, sends: [], receives: adds, keep: options.keep });
    let out: Scored | null = null;
    // Picking someone up only to drop him isn't a move
    if (!adds.some((a) => change.dropped.includes(a))) {
      const { model } = meansAfterTrade(data.model, inputs, [change]);
      const after = lineupByWeek(inputs, change.after);
      const weekWin = winOdds(model);
      out = {
        add: [...adds].sort((a, b) => (data.players[b]?.expectedPerWeek ?? 0) - (data.players[a]?.expectedPerWeek ?? 0)),
        drop: change.dropped,
        means: model,
        score: typeof target === 'number' ? weekWin - baseWeekWin : expectedWins(me, data.remaining, model) - baseWins,
        lineup: [avg(baseLineup), avg(after)],
        weekLineup: typeof target === 'number' ? [baseLineup[target] ?? 0, after[target] ?? 0] : [0, 0],
        weekWin,
      };
    }
    memo.set(key, out);
    return out;
  };

  const positions = options.positions?.length ? new Set(options.positions) : null;
  const eligible = inputs.freeAgents.filter(
    (fa) => (!positions || positions.has(inputs.positions[fa] ?? '')) && !(options.healthyOnly && unavailable(data.players[fa]?.injury))
  );
  // Sets are built from all free agents' best, so a set can pair a picked position with any other
  const pool = size > 1 ? inputs.freeAgents.filter((fa) => !(options.healthyOnly && unavailable(data.players[fa]?.injury))) : eligible;
  const singles: Scored[] = [];
  pool.forEach((fa, i) => {
    if (i % 10 === 9) onProgress({ stage: 'scoring', done: i + 1, total: pool.length * size });
    const r = evaluate([fa]);
    if (r && r.score > 1e-6) singles.push(r);
  });
  singles.sort((a, b) => b.score - a.score);

  let level: Scored[] = positions ? singles.filter((c) => positions.has(inputs.positions[c.add[0]] ?? '')) : singles;
  if (size > 1) {
    // The pool sets are built from: the best singles, at most 4 per position
    const perPos = new Map<string, number>();
    const base = singles.filter((c) => {
      const pos = inputs.positions[c.add[0]] ?? '';
      const n = perPos.get(pos) ?? 0;
      perPos.set(pos, n + 1);
      return n < 4;
    }).slice(0, POOL).map((c) => c.add[0]);
    for (let k = 2; k <= size; k++) {
      const next = new Map<string, Scored>();
      const from = (k === 2 ? base.map((id) => [id]) : level.slice(0, BEAM).map((c) => c.add));
      from.forEach((set, i) => {
        onProgress({ stage: 'scoring', done: pool.length * (k - 1) + Math.round(((i + 1) / from.length) * pool.length), total: pool.length * size });
        for (const extra of base) {
          if (set.includes(extra)) continue;
          const adds = [...set, extra];
          const key = keyOf(adds);
          if (next.has(key)) continue;
          const r = evaluate(adds);
          if (!r) continue;
          // Every pickup has to earn its place: better than the set without it
          const without = adds.map((x) => evaluate(adds.filter((y) => y !== x))?.score ?? 0);
          if (r.score - Math.max(...without) < MIN_EACH) continue;
          // With picked positions, every set includes one
          if (positions && !adds.some((a) => positions.has(inputs.positions[a] ?? ''))) continue;
          next.set(key, r);
        }
      });
      const found = [...next.values()].sort((a, b) => b.score - a.score);
      // No set this size helps more than a smaller one: show the largest that does
      if (!found.length) break;
      level = found;
    }
  }

  // Variety: at most 3 results per position for single pickups, and no player in more than 3 sets
  const perPositionCap = positions ? Math.max(PER_POSITION, Math.ceil(SHOWN / positions.size)) : PER_POSITION;
  const seen = new Map<string, number>();
  const finalists = level
    .filter((c) => {
      const keys = c.add.length === 1 ? [inputs.positions[c.add[0]] ?? ''] : c.add;
      if (keys.some((k) => (seen.get(k) ?? 0) >= (c.add.length === 1 ? perPositionCap : PER_POSITION))) return false;
      for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
      return true;
    })
    .slice(0, FINALISTS);
  const simulate = (m: TradeModel) =>
    simulatePlayoffOdds(data.teams, data.remaining, data.format, m.season.meanByWeek, m.season.spread, sims, seed, data.playoffWeekStart, data.hasToiletBowl, m.season.teamSpread, undefined, m.live?.games);
  const base = simulate(data.model);
  const results = finalists.map((c, i) => {
    const after = simulate(c.means);
    onProgress({ stage: 'simulating', done: i + 1, total: finalists.length });
    return {
      add: c.add,
      drop: c.drop,
      lineup: c.lineup,
      week:
        game && opponent !== null
          ? { week: game.week, opponent, winBefore: baseWeekWin, winAfter: c.weekWin, lineupBefore: c.weekLineup[0], lineupAfter: c.weekLineup[1] }
          : null,
      odds: [oddsFor(base, me), oddsFor(after, me)] as [WaiverOdds, WaiverOdds],
      score: c.score,
    };
  });

  // Rest of season: rank by the simulated playoff + title gain; a week: by that week's win odds
  const seasonGain = (r: (typeof results)[number]) =>
    r.odds[1].playoffs - r.odds[0].playoffs + (r.odds[1].champion ?? 0) - (r.odds[0].champion ?? 0);
  const ranked = typeof target === 'number'
    ? results.sort((a, b) => b.score - a.score || seasonGain(b) - seasonGain(a))
    : results.filter((r) => seasonGain(r) > 0).sort((a, b) => seasonGain(b) - seasonGain(a));
  onProgress({ stage: 'done', done: 1, total: 1 });
  return ranked.slice(0, SHOWN).map((r) => ({ add: r.add, drop: r.drop, lineup: r.lineup, week: r.week, odds: r.odds }));
}

/** Free agents worth trying for an automatic pickup: healthy, the best few at each position */
function candidates(data: TradeDataResponse, perPosition = 6): string[] {
  const byPos = new Map<string, string[]>();
  for (const fa of data.inputs.freeAgents) {
    if (unavailable(data.players[fa]?.injury)) continue;
    const pos = data.inputs.positions[fa] ?? '';
    byPos.set(pos, [...(byPos.get(pos) ?? []), fa]);
  }
  return [...byPos.values()].flatMap((list) =>
    list.sort((a, b) => (data.players[b]?.expectedPerWeek ?? 0) - (data.players[a]?.expectedPerWeek ?? 0)).slice(0, perPosition)
  );
}

/** A pickup has to add this many expected wins to be worth making */
export const PICKUP_MIN_WINS = 0.01;

/**
 * The best pickups (up to `max`, one at a time) after a roster change, judged on the team's
 * expected wins over its remaining games. `model` is the league with the change already in it.
 * Free agents in `exclude` (e.g. another team's pickups) aren't available.
 */
export function bestPickups(data: TradeDataResponse, model: TradeModel, change: RosterChange, exclude: string[] = [], max = 2): string[] {
  const { inputs } = data;
  const id = change.rosterId;
  const pool = candidates(data).filter((fa) => !exclude.includes(fa) && !change.after.includes(fa));
  const adds: string[] = [];
  let current = expectedWins(id, data.remaining, model);
  for (let step = 0; step < max; step++) {
    let best: { fa: string; wins: number } | null = null;
    for (const fa of pool) {
      if (adds.includes(fa)) continue;
      const next = withPickups(inputs, change, [...adds, fa]);
      if ([...adds, fa].some((a) => !next.after.includes(a))) continue;
      const { model: m } = meansAfterTrade(model, inputs, [{ ...next, before: change.after }]);
      const wins = expectedWins(id, data.remaining, m);
      if (!best || wins > best.wins) best = { fa, wins };
    }
    if (!best || best.wins - current < PICKUP_MIN_WINS) break;
    adds.push(best.fa);
    current = best.wins;
  }
  return adds;
}

/** Each team's best pickups without a trade and after it (the second team can't take the first's) */
export interface WaiverComparison {
  without: Record<number, string[]>;
  with: Record<number, string[]>;
}

export function waiverComparison(data: TradeDataResponse, changes: RosterChange[], tradeModel: TradeModel): WaiverComparison {
  const pick = (base: RosterChange[], model: TradeModel) => {
    const out: Record<number, string[]> = {};
    const taken: string[] = changes.flatMap((c) => c.added);
    for (const c of base) {
      out[c.rosterId] = bestPickups(data, model, c, taken);
      taken.push(...out[c.rosterId]);
    }
    return out;
  };
  return {
    without: pick(changes.map((c) => ({ rosterId: c.rosterId, before: c.before, after: c.before, dropped: [], added: [] })), data.model),
    with: pick(changes, tradeModel),
  };
}
