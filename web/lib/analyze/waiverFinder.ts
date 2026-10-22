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
 */

import { simulatePlayoffOdds, type OddsResult } from './playoffOdds';
import {
  expectedWins,
  lineupByWeek,
  meansAfterTrade,
  type TradeModel,
  rosterAfterTrade,
  weeklyWinProbability,
  type TradeDataResponse,
} from './trade';

/** 'season' for the rest of the season, or a remaining week number */
export type WaiverTarget = 'season' | number;

export interface WaiverOptions {
  target: WaiverTarget;
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
  add: string;
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
const SHOWN = 8;
/** At most this many results per position, so near-identical kickers don't crowd out the rest */
const PER_POSITION = 3;

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
  const regular = inputs.weeks.filter((w) => w <= data.regularSeasonEnd);
  const avg = (byWeek: Record<number, number>) => regular.reduce((s, w) => s + byWeek[w], 0) / Math.max(regular.length, 1);
  const target = options.target;
  const game = typeof target === 'number' ? data.remaining.find((g) => g.week === target && (g.a === me || g.b === me)) : undefined;
  const opponent = game ? (game.a === me ? game.b : game.a) : null;
  const winOdds = (m: TradeModel) =>
    game && opponent !== null
      ? weeklyWinProbability(m.games.meanByWeek[game.week]?.[me] ?? 0, m.games.meanByWeek[game.week]?.[opponent] ?? 0, m.games.spreadByWeek[game.week] ?? 25)
      : 0;

  const baseWins = expectedWins(me, data.remaining, data.model);
  const baseWeekWin = winOdds(data.model);
  const baseLineup = lineupByWeek(inputs, inputs.rosters[me] ?? []);

  const scored: Array<{ add: string; drop: string[]; means: TradeModel; score: number; lineup: [number, number]; weekLineup: [number, number]; weekWin: number }> = [];
  inputs.freeAgents.forEach((fa, i) => {
    const change = rosterAfterTrade(inputs, { rosterId: me, sends: [], receives: [fa] });
    // Picking someone up only to drop him isn't a move
    if (change.dropped.includes(fa)) return;
    const { model } = meansAfterTrade(data.model, inputs, [change]);
    const after = lineupByWeek(inputs, change.after);
    const weekWin = winOdds(model);
    const score = typeof target === 'number' ? weekWin - baseWeekWin : expectedWins(me, data.remaining, model) - baseWins;
    if (score > 1e-6) {
      scored.push({
        add: fa,
        drop: change.dropped,
        means: model,
        score,
        lineup: [avg(baseLineup), avg(after)],
        weekLineup: typeof target === 'number' ? [baseLineup[target] ?? 0, after[target] ?? 0] : [0, 0],
        weekWin,
      });
    }
    if (i % 10 === 9) onProgress({ stage: 'scoring', done: i + 1, total: inputs.freeAgents.length });
  });

  const perPosition = new Map<string, number>();
  const finalists = scored
    .sort((a, b) => b.score - a.score)
    .filter((c) => {
      const pos = inputs.positions[c.add] ?? '';
      const n = perPosition.get(pos) ?? 0;
      perPosition.set(pos, n + 1);
      return n < PER_POSITION;
    })
    .slice(0, FINALISTS);
  const simulate = (m: TradeModel) =>
    simulatePlayoffOdds(data.teams, data.remaining, data.format, m.season.meanByWeek, m.season.spread, sims, seed, data.playoffWeekStart, data.hasToiletBowl, m.season.teamSpread);
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
