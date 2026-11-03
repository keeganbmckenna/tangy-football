/**
 * Lifetime luck (History tab): each manager's regular-season wins against the wins their scoring
 * would have earned on other schedules, over every Sleeper season. Each season shuffles its
 * schedule the way the season's own luck chart does (lib/analyze/scheduleLuck.ts), keeping every
 * team's real weekly scores; a manager's seasons then add up exactly (their win distributions
 * convolved), so the lifetime range and percentile are as right as each season's.
 *
 * Seasons before Sleeper kept final standings only, no weekly scores, so they can't be reshuffled
 * and aren't counted. The season in progress counts its finished weeks.
 */

import type { HistoryData } from './history';
import { CLOSE_GAME_MARGIN } from './luck';
import { simulateScheduleLuck, type ScheduleLuckTeam } from './scheduleLuck';

export interface LuckOutcome {
  wins: number;
  frequency: number;
}

export interface LifetimeLuckSeason {
  season: string;
  games: number;
  /** Real wins, ties as half */
  wins: number;
  /** Average wins over the season's shuffled schedules */
  expected: number;
  /** wins − expected */
  luck: number;
}

export interface LifetimeLuckRow {
  userId: string;
  /** Newest first */
  seasons: LifetimeLuckSeason[];
  games: number;
  record: { wins: number; losses: number; ties: number };
  /** Real wins, ties as half */
  wins: number;
  expected: number;
  luck: number;
  /** Share of schedules that would have given fewer wins (ties between the two count half) */
  percentile: number;
  /** The middle 80% of lifetime win totals over the schedules */
  range: [number, number];
  /** Lifetime win totals over the schedules (fewest first) */
  outcomes: LuckOutcome[];
  close: { wins: number; losses: number; ties: number };
  luckiest: LifetimeLuckSeason | null;
  unluckiest: LifetimeLuckSeason | null;
}

export interface LifetimeLuck {
  /** Seasons counted, newest first */
  seasons: string[];
  simulations: number;
  /** The counted season still being played (its finished weeks count), if any */
  inProgress: string | null;
  /** Most fortunate first (by percentile, then wins over expected) */
  rows: LifetimeLuckRow[];
}

/** Small seeded uniform RNG (mulberry32), so the numbers don't change between visits */
function uniform(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Win totals in half wins (ties), so they add up as integers
type Dist = Map<number, number>;
const half = (wins: number) => Math.round(wins * 2);

function convolve(x: Dist, y: Dist): Dist {
  const out: Dist = new Map();
  for (const [a, pa] of x) for (const [b, pb] of y) out.set(a + b, (out.get(a + b) ?? 0) + pa * pb);
  return out;
}

const mean = (d: Dist) => [...d].reduce((s, [k, p]) => s + (k / 2) * p, 0);

/** The smallest total with at least this share of schedules at or below it */
function quantile(sorted: Array<[number, number]>, q: number) {
  let cum = 0;
  for (const [k, p] of sorted) {
    cum += p;
    if (cum >= q - 1e-9) return k / 2;
  }
  return sorted[sorted.length - 1][0] / 2;
}

export function lifetimeLuck(data: HistoryData, simulations = 20000): LifetimeLuck {
  const seasons: string[] = [];
  let inProgress: string | null = null;
  // By manager: each season's win distribution and line
  const perManager = new Map<string, Array<{ dist: Dist; line: LifetimeLuckSeason }>>();
  const records = new Map<string, LifetimeLuckRow['record']>();
  const close = new Map<string, LifetimeLuckRow['close']>();

  for (const s of data.seasons) {
    if (s.legacy) continue;
    const games = data.games.filter((g) => g.season === s.season && g.kind === 'regular' && (g.pa > 0 || g.pb > 0));
    if (!games.length) continue;
    seasons.push(s.season);
    if (!s.complete) inProgress = s.season;
    const weeks = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
    const teams = new Map<string, ScheduleLuckTeam & { losses: number }>();
    for (const g of games) {
      for (const [me, pf, pa] of [[g.a, g.pa, g.pb], [g.b, g.pb, g.pa]] as const) {
        const t = teams.get(me) ?? { username: me, teamName: me, wins: 0, losses: 0, ties: 0, weeklyScores: weeks.map(() => 0) };
        t.weeklyScores[weeks.indexOf(g.week)] = pf;
        if (pf > pa) t.wins++;
        else if (pf < pa) t.losses++;
        else t.ties++;
        teams.set(me, t);

        const c = close.get(me) ?? { wins: 0, losses: 0, ties: 0 };
        if (Math.abs(pf - pa) < CLOSE_GAME_MARGIN) {
          if (pf > pa) c.wins++;
          else if (pf < pa) c.losses++;
          else c.ties++;
        }
        close.set(me, c);
      }
    }
    for (const [id, t] of teams) {
      const r = records.get(id) ?? { wins: 0, losses: 0, ties: 0 };
      r.wins += t.wins;
      r.losses += t.losses;
      r.ties += t.ties;
      records.set(id, r);
    }

    const sim = simulateScheduleLuck([...teams.values()], simulations, undefined, uniform(Number(s.season) * 7919));
    for (const team of sim.teams) {
      const dist: Dist = new Map(team.outcomes.map((o) => [half(o.wins), o.frequency]));
      const expected = mean(dist);
      const t = teams.get(team.username)!;
      const line = { season: s.season, games: t.wins + t.losses + t.ties, wins: team.actualWins, expected, luck: team.actualWins - expected };
      perManager.set(team.username, [...(perManager.get(team.username) ?? []), { dist, line }]);
    }
  }

  const rows: LifetimeLuckRow[] = [...perManager].map(([userId, list]) => {
    const dist = list.map((x) => x.dist).reduce(convolve);
    const sorted = [...dist].sort((a, b) => a[0] - b[0]);
    const lines = list.map((x) => x.line);
    const wins = lines.reduce((s, l) => s + l.wins, 0);
    const expected = mean(dist);
    const below = sorted.filter(([k]) => k < half(wins)).reduce((s, [, p]) => s + p, 0);
    const at = dist.get(half(wins)) ?? 0;
    const byLuck = [...lines].sort((a, b) => b.luck - a.luck);
    return {
      userId,
      seasons: lines,
      games: lines.reduce((s, l) => s + l.games, 0),
      record: records.get(userId)!,
      wins,
      expected,
      luck: wins - expected,
      percentile: below + at / 2,
      range: [quantile(sorted, 0.1), quantile(sorted, 0.9)],
      outcomes: sorted.map(([k, p]) => ({ wins: k / 2, frequency: p })),
      close: close.get(userId)!,
      luckiest: byLuck.length > 1 && byLuck[0].luck > 0 ? byLuck[0] : null,
      unluckiest: byLuck.length > 1 && byLuck[byLuck.length - 1].luck < 0 ? byLuck[byLuck.length - 1] : null,
    };
  });
  rows.sort((a, b) => b.percentile - a.percentile || b.luck - a.luck);
  return { seasons, simulations, inProgress, rows };
}
