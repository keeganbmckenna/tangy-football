/**
 * Trade finder: given one team, search its trades with every other manager
 * for ones that help it without hurting the trade partner.
 *
 * Sizes: 1-for-1, 1-for-2 and 2-for-1, 2-for-2, 3-for-1 and 1-for-3, 3-for-2
 * and 2-for-3, from each roster's most valuable players, or every player in a
 * deep search (kickers, defenses and players in IR slots aren't traded here). Three stages, each narrowing the field:
 *
 *  1. Screen every trade with each player's average expected points: both
 *     teams' best lineups before and after (microseconds per trade).
 *  2. Re-score the best few hundred week by week (byes count), with the
 *     roster moves the trade forces (drops, free-agent pickups), and the
 *     expected wins the playoff model gives each team over its real schedule.
 *  3. Simulate the finalists' seasons (the playoff model, same random draws as
 *     without the trade) and keep trades where the partner's playoff and title
 *     odds don't drop and its odds of losing the toilet bowl don't rise.
 *
 * Optional market filter (FantasyCalc redraft values): skip trades the market
 * sees as clearly lopsided against the partner. Values aren't additive:
 * managers pay a premium for the best player in a deal (a 2-for-1 has cost
 * about 1.36x the star's value in real trades), so packages are compared on a
 * 1.75-norm of their values, which reproduces that premium.
 */

import { bestLineup, simulatePlayoffOdds, type OddsResult, type Streams } from './playoffOdds';
import {
  expectedWins as expectedWinsFor,
  meansAfterTrade,
  rosterAfterTrade,
  type TradeDataResponse,
} from './trade';

export const TRADE_SIZES: Array<[number, number]> = [
  [1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [1, 3], [3, 2], [2, 3],
];
/** Players per roster the finder trades from */
export const POOL_SIZE = 10;
const SHORTLIST = 200;
const FINALISTS = 20;
const SHOWN = 8;
/** Most finalists / shown trades with any one manager, so the list covers several partners */
const FINALISTS_PER_PARTNER = 4;
const SHOWN_PER_PARTNER = 2;
/** A partner may lose this much projected lineup (pts/wk) in the screen; the odds decide in the end */
const PARTNER_LINEUP_SLACK = 0.5;
/** Changes smaller than this (in probability) count as no change for the partner */
const ODDS_TOLERANCE = 0.005;
const MARKET_NORM = 1.75;
/** The partner must get back at least this share of the market value it gives */
export const MARKET_FAIR_SHARE = 0.85;
const NOT_TRADED = new Set(['K', 'DEF']);

export interface FinderOptions {
  marketFilter: boolean;
  /** Search every player on both rosters instead of each roster's POOL_SIZE most valuable (slower) */
  deep?: boolean;
  sims?: number;
  finalSims?: number;
  seed?: number;
}

export interface OddsLine {
  playoffs: number;
  champion: number | null;
  lastPlace: number | null;
  expectedWins: number;
}

export interface FoundTrade {
  partner: number;
  /** Your players going to the partner */
  gives: string[];
  /** The partner's players coming to you */
  gets: string[];
  size: string;
  /** Expected lineup points per remaining regular-season week, before -> after */
  lineup: { me: [number, number]; partner: [number, number] };
  odds: { me: [OddsLine, OddsLine]; partner: [OddsLine, OddsLine] };
  /**
   * FantasyCalc value sums: what you give and what you get; fair: whether the partner gets
   * enough back (the filter), mine: whether you do (a warning, since the model may see a
   * reason to pay more)
   */
  market: { give: number; get: number; fair: boolean | null; mine: boolean | null };
  /** Forced roster moves */
  moves: { meDrops: string[]; meAdds: string[]; partnerDrops: string[]; partnerAdds: string[] };
}

export interface FinderProgress {
  stage: 'screening' | 'rescoring' | 'simulating' | 'done';
  done: number;
  total: number;
}

const combos = <T,>(items: T[], k: number): T[][] => {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc);
      return;
    }
    for (let i = start; i < items.length; i++) pick(i + 1, [...acc, items[i]]);
  };
  pick(0, []);
  return out;
};

/** Market value of a package: a 1.75-norm, so one star outweighs the same total spread over pieces */
export function packageValue(values: number[]): number {
  return Math.pow(values.reduce((s, v) => s + Math.pow(Math.max(v, 0), MARKET_NORM), 0), 1 / MARKET_NORM);
}

/** Whether the partner gets back enough market value for what it gives (null if neither side is valued) */
export function marketFair(partnerGives: number[], partnerGets: number[]): boolean | null {
  const give = packageValue(partnerGives);
  if (give === 0) return null;
  return packageValue(partnerGets) >= MARKET_FAIR_SHARE * give;
}

const oddsLine = (o: OddsResult, id: number): OddsLine => ({
  playoffs: o.teams[id].playoffs,
  champion: o.teams[id].champion,
  lastPlace: o.teams[id].lastPlace,
  expectedWins: o.teams[id].expectedWins,
});

/**
 * Trades for `me` that help it without hurting the partner, best first.
 * onProgress is called as each stage advances.
 */
export function findTrades(
  data: TradeDataResponse,
  me: number,
  options: FinderOptions,
  onProgress: (p: FinderProgress) => void = () => {}
): FoundTrade[] {
  const { inputs } = data;
  const sims = options.sims ?? 3000;
  const finalSims = options.finalSims ?? 10000;
  const seed = options.seed ?? 2026;
  const regular = inputs.weeks.filter((w) => w <= data.regularSeasonEnd);
  const value = (p: string) => data.players[p]?.value ?? 0;

  // Stage 1: screen with season-average expected points
  const avg: Record<string, { position: string; points: number }> = {};
  for (const [p, position] of Object.entries(inputs.positions)) {
    avg[p] = { position, points: regular.reduce((s, w) => s + (inputs.projections[p]?.[w] ?? 0), 0) / Math.max(regular.length, 1) };
  }
  // Free agents to stream from, averaged the same way
  const avgStreams: Streams = {};
  for (const w of regular) {
    for (const [pos, list] of Object.entries(inputs.streams[w] ?? {})) {
      const out = (avgStreams[pos] ??= []);
      list.forEach((v, i) => (out[i] = (out[i] ?? 0) + v / Math.max(regular.length, 1)));
    }
  }
  const lineup = (players: string[]) => bestLineup(players, avg, inputs.rosterPositions, avgStreams).total;
  const pool = (id: number) =>
    (inputs.rosters[id] ?? [])
      .filter((p) => avg[p] && !NOT_TRADED.has(avg[p].position) && !(inputs.reserve?.[id] ?? []).includes(p))
      .sort((a, b) => avg[b].points - avg[a].points)
      .slice(0, options.deep ? undefined : POOL_SIZE);
  const packages = (players: string[]) => Object.fromEntries([1, 2, 3].map((k) => [k, combos(players, k)])) as Record<number, string[][]>;

  const partners = data.teams.map((t) => t.rosterId).filter((id) => id !== me);
  const myRoster = inputs.rosters[me] ?? [];
  const myPackages = packages(pool(me));
  const myBefore = lineup(myRoster);
  const total = partners.reduce((s, id) => {
    const theirs = packages(pool(id));
    return s + TRADE_SIZES.reduce((n, [g, r]) => n + myPackages[g].length * theirs[r].length, 0);
  }, 0);

  type Screened = { partner: number; gives: string[]; gets: string[]; gain: number };
  const screened: Screened[] = [];
  let checked = 0;
  for (const partner of partners) {
    const theirRoster = inputs.rosters[partner] ?? [];
    const theirPackages = packages(pool(partner));
    const theirBefore = lineup(theirRoster);
    for (const [g, r] of TRADE_SIZES) {
      for (const gives of myPackages[g]) {
        const myKept = myRoster.filter((p) => !gives.includes(p));
        for (const gets of theirPackages[r]) {
          checked++;
          if (options.marketFilter && marketFair(gets.map(value), gives.map(value)) === false) continue;
          const gain = lineup([...myKept, ...gets]) - myBefore;
          if (gain <= 0) continue;
          const theirGain = lineup([...theirRoster.filter((p) => !gets.includes(p)), ...gives]) - theirBefore;
          if (theirGain < -PARTNER_LINEUP_SLACK) continue;
          screened.push({ partner, gives, gets, gain });
        }
      }
      onProgress({ stage: 'screening', done: checked, total });
    }
  }

  // Stage 2: week by week, with forced roster moves and expected wins
  // Best screened trades, at most a fifth of the shortlist from any one partner
  const perPartner = new Map<number, number>();
  const shortlist = screened
    .sort((a, b) => b.gain - a.gain)
    .filter((c) => {
      const n = perPartner.get(c.partner) ?? 0;
      if (n >= SHORTLIST / 5) return false;
      perPartner.set(c.partner, n + 1);
      return true;
    })
    .slice(0, SHORTLIST);
  const expectedWins = (id: number, means: Record<number, Record<number, number>>) =>
    expectedWinsFor(id, data.remaining, means, data.spread);
  const avgLineup = (players: string[]) => {
    const byWeek = regular.map((w) => {
      const week = Object.fromEntries(
        players.filter((p) => inputs.positions[p]).map((p) => [p, { position: inputs.positions[p], points: inputs.projections[p]?.[w] ?? 0 }])
      );
      return bestLineup(players, week, inputs.rosterPositions, inputs.streams[w] ?? {}).total;
    });
    return byWeek.reduce((s, v) => s + v, 0) / Math.max(byWeek.length, 1);
  };
  const baseWins = Object.fromEntries(data.teams.map((t) => [t.rosterId, expectedWins(t.rosterId, data.meanByWeek)]));

  type Rescored = Screened & {
    means: Record<number, Record<number, number>>;
    winGain: number;
    lineup: FoundTrade['lineup'];
    moves: FoundTrade['moves'];
  };
  const rescored: Rescored[] = [];
  shortlist.forEach((c, i) => {
    const mine = rosterAfterTrade(inputs, { rosterId: me, sends: c.gives, receives: c.gets });
    const theirs = rosterAfterTrade(inputs, { rosterId: c.partner, sends: c.gets, receives: c.gives }, mine.added);
    const { meanByWeek } = meansAfterTrade(data.meanByWeek, inputs, [mine, theirs]);
    const winGain = expectedWins(me, meanByWeek) - baseWins[me];
    const partnerWinGain = expectedWins(c.partner, meanByWeek) - baseWins[c.partner];
    const lineupMine: [number, number] = [avgLineup(mine.before), avgLineup(mine.after)];
    const lineupTheirs: [number, number] = [avgLineup(theirs.before), avgLineup(theirs.after)];
    if (winGain > 0 && lineupTheirs[1] - lineupTheirs[0] >= -PARTNER_LINEUP_SLACK && partnerWinGain > -0.1) {
      rescored.push({
        ...c,
        means: meanByWeek,
        winGain,
        lineup: { me: lineupMine, partner: lineupTheirs },
        moves: { meDrops: mine.dropped, meAdds: mine.added, partnerDrops: theirs.dropped, partnerAdds: theirs.added },
      });
    }
    if (i % 20 === 19) onProgress({ stage: 'rescoring', done: i + 1, total: shortlist.length });
  });

  // One trade per pairing of key players (drop near-duplicates that only differ
  // by throw-ins), and a few per manager
  const seen = new Set<string>();
  const finalistsPer = new Map<number, number>();
  const distinct = rescored
    .sort((a, b) => b.winGain - a.winGain)
    .filter((c) => {
      const key = `${c.partner}:${c.gives[0]}:${c.gets[0]}`;
      const n = finalistsPer.get(c.partner) ?? 0;
      if (seen.has(key) || n >= FINALISTS_PER_PARTNER) return false;
      seen.add(key);
      finalistsPer.set(c.partner, n + 1);
      return true;
    })
    .slice(0, FINALISTS);

  // Stage 3: simulate the finalists on the same draws as the baseline
  const simulate = (means: Record<number, Record<number, number>>, n: number) =>
    simulatePlayoffOdds(data.teams, data.remaining, data.format, means, data.spread, n, seed, data.playoffWeekStart, data.hasToiletBowl);
  const base = simulate(data.meanByWeek, sims);
  const notHurt = (b: OddsLine, a: OddsLine) =>
    a.playoffs >= b.playoffs - ODDS_TOLERANCE &&
    (a.champion ?? 0) >= (b.champion ?? 0) - ODDS_TOLERANCE &&
    (a.lastPlace ?? 0) <= (b.lastPlace ?? 0) + ODDS_TOLERANCE;
  const finalists: Array<Rescored & { score: number }> = [];
  distinct.forEach((c, i) => {
    const after = simulate(c.means, sims);
    const meB = oddsLine(base, me);
    const meA = oddsLine(after, me);
    if (notHurt(oddsLine(base, c.partner), oddsLine(after, c.partner)) && meA.playoffs + (meA.champion ?? 0) > meB.playoffs + (meB.champion ?? 0)) {
      finalists.push({ ...c, score: meA.playoffs - meB.playoffs + (meA.champion ?? 0) - (meB.champion ?? 0) });
    }
    onProgress({ stage: 'simulating', done: i + 1, total: distinct.length + SHOWN });
  });

  // The ones shown get a bigger simulation (the analyzer runs 20,000)
  const shownPer = new Map<number, number>();
  const shown = finalists
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      const n = shownPer.get(c.partner) ?? 0;
      shownPer.set(c.partner, n + 1);
      return n < SHOWN_PER_PARTNER;
    })
    .slice(0, SHOWN);
  const fullBase = simulate(data.meanByWeek, finalSims);
  const results: FoundTrade[] = [];
  shown.forEach((c, i) => {
    const after = simulate(c.means, finalSims);
    const partnerB = oddsLine(fullBase, c.partner);
    const partnerA = oddsLine(after, c.partner);
    onProgress({ stage: 'simulating', done: distinct.length + i + 1, total: distinct.length + SHOWN });
    if (!notHurt(partnerB, partnerA)) return;
    results.push({
      partner: c.partner,
      gives: c.gives,
      gets: c.gets,
      size: `${c.gives.length}-for-${c.gets.length}`,
      lineup: c.lineup,
      odds: { me: [oddsLine(fullBase, me), oddsLine(after, me)], partner: [partnerB, partnerA] },
      market: {
        give: c.gives.reduce((s, p) => s + value(p), 0),
        get: c.gets.reduce((s, p) => s + value(p), 0),
        fair: marketFair(c.gets.map(value), c.gives.map(value)),
        mine: marketFair(c.gives.map(value), c.gets.map(value)),
      },
      moves: c.moves,
    });
  });
  onProgress({ stage: 'done', done: 1, total: 1 });
  return results;
}
