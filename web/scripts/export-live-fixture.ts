/**
 * Parity fixture for the live-odds research port (scripts/backtests/live_model.py): random
 * inputs to the Live tab's model functions in lib/analyze/live.ts and what they return, so the
 * PyTorch version that replays the crawled leagues can be checked against the site's own code.
 *
 *   npx tsx scripts/export-live-fixture.ts
 *
 * Writes scripts/backtests/live_odds_fixture.json. Seeded: the same file every run.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SleeperMatchup } from '../lib/types';
import { defenseExpected, gameRemaining, liveWinOdds, playerSpreadRatio, type LiveGame, type LiveProjection } from '../lib/analyze/live';
import { normalCdf } from '../lib/analyze/trade';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'scripts', 'backtests', 'live_odds_fixture.json');

/** mulberry32: a small seeded generator */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261026);
const uniform = (lo: number, hi: number) => lo + (hi - lo) * rand();
const int = (lo: number, hi: number) => Math.floor(uniform(lo, hi + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

// Points-allowed scoring: ours, a common one, and an odd one with gaps and a linear key
const SCORINGS: Array<Record<string, number>> = [
  { pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4 },
  { pts_allow_0: 5, pts_allow_1_6: 4, pts_allow_7_13: 3, pts_allow_14_20: 1, pts_allow_28_34: -1, pts_allow_35p: -3 },
  { pts_allow_0: 12, pts_allow_7_13: 3, pts_allow_35p: -6, pts_allow: -0.1 },
];

const gameCases = Array.from({ length: 400 }, () => {
  const state = pick(['pre', 'in', 'in', 'in', 'post'] as const);
  const period = state === 'in' ? int(1, 5) : 1;
  const clock = state === 'in' ? int(0, period > 4 ? 600 : 900) : 0;
  const margin = pick([0, 0, int(-3, 3), int(-30, 30)]);
  return { state, period, clock, margin, out: gameRemaining(state, period, clock, margin) };
});

const defenseCases = Array.from({ length: 300 }, () => {
  const scoring = pick(SCORINGS);
  const started = rand() < 0.8;
  const allowedNow = started ? int(0, 45) : 0;
  const projection = { allowed: uniform(12, 30), other: uniform(2, 9) };
  const remaining = pick([0, 1, uniform(0, 1), uniform(0, 0.05), uniform(1, 1.1)]);
  const points = uniform(-4, 20);
  return { points, started, allowedNow, projection, remaining, scoring, out: defenseExpected(points, started, allowedNow, projection, remaining, scoring) };
});

const cdfCases = Array.from({ length: 200 }, (_, i) => {
  const z = i < 100 ? -6 + (12 * i) / 99 : uniform(-10, 10);
  return { z, out: normalCdf(z) };
});

const spreadCases = Array.from({ length: 100 }, () => {
  const position = pick(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'LB']);
  const scores = Array.from({ length: int(0, 12) }, () => (rand() < 0.1 ? 0 : uniform(0, 35)));
  return { position, scores, out: playerSpreadRatio(position, scores) };
});

const POSITIONS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'K', 'DEF'];
const TEAMS = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'];

const oddsCases = Array.from({ length: 20 }, (_, c) => {
  const scoring = pick(SCORINGS);
  const games: Record<string, LiveGame> = {};
  for (const team of TEAMS) {
    if (rand() < 0.06) continue; // a bye
    const state = pick(['pre', 'in', 'post'] as const);
    const remaining = state === 'pre' ? 1 : state === 'post' ? 0 : uniform(0, 1.05);
    games[team] = { state, remaining, label: '', ...(state !== 'pre' && { score: int(0, 35), opponentScore: int(0, 35) }) };
  }
  const projections: Record<string, LiveProjection> = {};
  const allowed: Record<string, number> = {};
  const matchups: SleeperMatchup[] = [];
  const nTeams = 12;
  for (let r = 1; r <= nTeams; r++) {
    const starters: string[] = [];
    const players_points: Record<string, number> = {};
    POSITIONS.forEach((position, i) => {
      if (rand() < 0.03) {
        starters.push('0'); // an empty slot
        return;
      }
      const team = pick(TEAMS);
      const id = position === 'DEF' ? `${team}${c}_${r}` : `p${c}_${r}_${i}`;
      starters.push(id);
      const g = games[team];
      const started = !!g && g.state !== 'pre';
      if (position === 'DEF') {
        const defense = { allowed: uniform(15, 28), other: uniform(3, 8) };
        if (started) allowed[id] = int(0, 40);
        projections[id] = { points: defenseExpected(0, false, 0, defense, 1, scoring), defense, spreadRatio: uniform(0.4, 1.2), team, name: id, position, injury: null };
        players_points[id] = started ? uniform(-4, 18) : 0;
      } else if (rand() < 0.95) {
        projections[id] = { points: uniform(0, 25), spreadRatio: uniform(0.3, 1.5), team, name: id, position, injury: null };
        players_points[id] = started ? uniform(0, 30) : 0;
      } else {
        players_points[id] = uniform(0, 10); // no projection: scores, but isn't modelled
      }
    });
    matchups.push({
      roster_id: r,
      matchup_id: r <= 2 && c % 5 === 0 ? null : Math.ceil(r / 2),
      starters,
      players: starters,
      players_points,
      points: starters.reduce((s, id) => s + (players_points[id] ?? 0), 0),
    } as SleeperMatchup);
  }
  // The defenses' projections keyed by their IDs, which aren't real team codes here
  const spread = uniform(15, 35);
  const defense = { allowed, allowedScoring: scoring };
  const out = liveWinOdds(matchups, projections, games, spread, defense).map((o) => ({
    matchupId: o.matchupId,
    a: o.a.rosterId,
    b: o.b.rosterId,
    aProjected: o.a.projected,
    bProjected: o.b.projected,
    aWinOdds: o.aWinOdds,
    sd: o.sd,
  }));
  return { matchups, projections, games, spread, defense, out };
});

writeFileSync(OUT, JSON.stringify({ gameRemaining: gameCases, defenseExpected: defenseCases, normalCdf: cdfCases, playerSpreadRatio: spreadCases, liveWinOdds: oddsCases }));
console.log(`Wrote ${OUT}`);
