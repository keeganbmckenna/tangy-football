/**
 * How accurate the site's odds have been in this league (the Playoffs tab's "How accurate are
 * the odds?"): each regular-season matchup's odds at the week's first kickoff against who won,
 * and every team's playoff odds each week of a finished season against who made it. The rows
 * come from public/data/accuracy.json (scripts/build-accuracy.ts); this groups them into bands.
 */

/** One matchup, from the favorite's side: its chance at the week's first kickoff, and whether it won */
export interface GameRow {
  season: string;
  week: number;
  p: number;
  won: boolean;
}

/** One team at one week of a finished season (week 0: after the draft): its playoff odds, and whether it made it */
export interface PlayoffRow {
  season: string;
  week: number;
  p: number;
  made: boolean;
}

export interface AccuracyData {
  games: GameRow[];
  playoffs: PlayoffRow[];
  generatedAt: string;
}

export interface Outcome {
  p: number;
  hit: boolean;
}

export interface Band {
  /** The band's odds, [lo, hi) */
  lo: number;
  hi: number;
  n: number;
  /** The average odds given in the band */
  predicted: number;
  /** How often it happened */
  actual: number;
  /** The range the true rate likely falls in (80% Wilson interval) */
  low: number;
  high: number;
}

/** z for an 80% interval */
const Z80 = 1.2816;

/** The Wilson score interval for k of n (80% by default) */
export function wilson(k: number, n: number, z = Z80): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** The outcomes grouped by the odds given: edges [a, b, c] make bands [a, b) and [b, c] (the last one closed); empty bands are left out */
export function bands(rows: Outcome[], edges: number[]): Band[] {
  const out: Band[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const last = i === edges.length - 2;
    const inBand = rows.filter((r) => r.p >= lo && (last ? r.p <= hi : r.p < hi));
    if (!inBand.length) continue;
    const k = inBand.filter((r) => r.hit).length;
    out.push({
      lo,
      hi,
      n: inBand.length,
      predicted: inBand.reduce((s, r) => s + r.p, 0) / inBand.length,
      actual: k / inBand.length,
      ...wilson(k, inBand.length),
    });
  }
  return out;
}

/** Mean squared error of the odds (lower is better; always saying 50% scores 0.25) */
export function brier(rows: Outcome[]): number {
  if (!rows.length) return NaN;
  return rows.reduce((s, r) => s + (r.p - (r.hit ? 1 : 0)) ** 2, 0) / rows.length;
}

export interface AccuracySummary {
  n: number;
  /** The average odds given */
  predicted: number;
  /** How often it happened */
  actual: number;
  brier: number;
  bands: Band[];
}

export function summarize(rows: Outcome[], edges: number[]): AccuracySummary {
  return {
    n: rows.length,
    predicted: rows.length ? rows.reduce((s, r) => s + r.p, 0) / rows.length : NaN,
    actual: rows.length ? rows.filter((r) => r.hit).length / rows.length : NaN,
    brier: brier(rows),
    bands: bands(rows, edges),
  };
}

/** The favorite's odds, in bands of 10 points */
export const GAME_EDGES = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
/** Playoff odds, finer at the ends where most teams sit */
export const PLAYOFF_EDGES = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1];
/** Teams already in or out (odds this close to 0 or 1) say nothing about the model, so they're left out */
export const DECIDED = 0.005;

export function gameAccuracy(data: AccuracyData): AccuracySummary {
  return summarize(
    data.games.map((g) => ({ p: g.p, hit: g.won })),
    GAME_EDGES
  );
}

export function playoffAccuracy(data: AccuracyData): AccuracySummary {
  return summarize(
    data.playoffs.filter((r) => r.p > DECIDED && r.p < 1 - DECIDED).map((r) => ({ p: r.p, hit: r.made })),
    PLAYOFF_EDGES
  );
}
