/**
 * League history across every season: champions, all-time standings,
 * head-to-head records, rivalries and a record book. Managers are tracked by
 * their Sleeper account, so a roster slot changing hands between seasons
 * doesn't mix two managers' records.
 *
 * Head-to-head records, rivalries and game records count regular-season and
 * playoff games. Placement games (3rd and 5th place) are left out: teams often
 * don't set lineups for them (a 2022 5th-place game ended 12.70-3.00), and so
 * are consolation and toilet bowl games, where the lower score advances.
 */

import type { SleeperBracketMatchup } from '../types';

export type GameKind = 'regular' | 'playoff' | 'placement' | 'consolation' | 'toilet';

export interface HistoryGame {
  season: string;
  week: number;
  /** Manager (Sleeper user ID) on each side */
  a: string;
  b: string;
  pa: number;
  pb: number;
  kind: GameKind;
}

export interface HistorySeasonTeam {
  userId: string;
  rosterId: number;
  teamName: string;
  avatarUrl: string | null;
}

export interface HistorySeason {
  season: string;
  complete: boolean;
  teams: HistorySeasonTeam[];
  champion: string | null;
  runnerUp: string | null;
  /** Lost the toilet bowl (last place) */
  toiletLoser: string | null;
  playoffTeams: string[];
  /** Final placements from the playoff bracket (1 = champion), by manager */
  placements: Record<string, number>;
}

export interface HistoryManager {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface HistoryData {
  managers: HistoryManager[];
  /** Newest first */
  seasons: HistorySeason[];
  games: HistoryGame[];
  generatedAt: string;
}

/** Games that count for head-to-head records, rivalries and game records */
export const countsForRecords = (g: HistoryGame) => g.kind === 'regular' || g.kind === 'playoff';

// ---------------------------------------------------------------------------
// Postseason classification

/**
 * What kind of game two rosters played in a postseason week: a winners
 * bracket game (placement if it decides a place other than 1st), a toilet
 * bowl (losers bracket) game, or a consolation game outside both brackets.
 */
export function postseasonKind(
  round: number,
  rosters: [number, number],
  winners: SleeperBracketMatchup[] | null,
  losers: SleeperBracketMatchup[] | null
): GameKind {
  const has = (m: SleeperBracketMatchup) => {
    const ids = [m.t1, m.t2];
    return m.r === round && rosters.every((r) => ids.includes(r));
  };
  const w = winners?.find(has);
  if (w) return w.p && w.p !== 1 ? 'placement' : 'playoff';
  if (losers?.some(has)) return 'toilet';
  return 'consolation';
}

/** Champion, runner-up, toilet bowl loser, playoff teams and placements (by roster) from a season's brackets */
export function bracketResults(winners: SleeperBracketMatchup[] | null, losers: SleeperBracketMatchup[] | null) {
  const final = winners?.find((m) => m.p === 1);
  const toiletFinal = losers?.find((m) => m.p === 1);
  const placements: Record<number, number> = {};
  for (const m of winners ?? []) {
    if (!m.p || !m.w || !m.l) continue;
    placements[m.w] = m.p;
    placements[m.l] = m.p + 1;
  }
  const playoffTeams = new Set<number>();
  for (const m of winners ?? []) {
    for (const t of [m.t1, m.t2]) if (typeof t === 'number') playoffTeams.add(t);
  }
  return {
    champion: final?.w ?? null,
    runnerUp: final?.l ?? null,
    // In the toilet bowl the lower score advances, so the final's "winner" lost it
    toiletLoser: toiletFinal?.w ?? null,
    playoffTeams: [...playoffTeams],
    placements,
  };
}

// ---------------------------------------------------------------------------
// All-time standings

export interface AllTimeRow {
  userId: string;
  seasons: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  pointsFor: number;
  games: number;
  pointsPerGame: number;
  playoffs: number;
  finals: number;
  titles: number;
  toiletLosses: number;
  /** Best final placement (1 = champion), null if never placed */
  bestFinish: number | null;
}

/** Regular-season records plus postseason results, one row per manager */
export function allTimeStandings(data: HistoryData): AllTimeRow[] {
  const rows = new Map<string, AllTimeRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { userId: id, seasons: 0, wins: 0, losses: 0, ties: 0, winPct: 0, pointsFor: 0, games: 0, pointsPerGame: 0, playoffs: 0, finals: 0, titles: 0, toiletLosses: 0, bestFinish: null };
      rows.set(id, r);
    }
    return r;
  };
  for (const s of data.seasons) {
    for (const t of s.teams) row(t.userId).seasons++;
    for (const id of s.playoffTeams) row(id).playoffs++;
    if (s.champion) row(s.champion).titles++;
    for (const id of [s.champion, s.runnerUp]) if (id) row(id).finals++;
    if (s.toiletLoser) row(s.toiletLoser).toiletLosses++;
    for (const [id, place] of Object.entries(s.placements)) {
      const r = row(id);
      r.bestFinish = r.bestFinish === null ? place : Math.min(r.bestFinish, place);
    }
  }
  for (const g of data.games) {
    if (g.kind !== 'regular') continue;
    for (const [me, pf, pa] of [[g.a, g.pa, g.pb], [g.b, g.pb, g.pa]] as const) {
      const r = row(me);
      r.games++;
      r.pointsFor += pf;
      if (pf > pa) r.wins++;
      else if (pf < pa) r.losses++;
      else r.ties++;
    }
  }
  for (const r of rows.values()) {
    r.winPct = r.games ? (r.wins + r.ties / 2) / r.games : 0;
    r.pointsPerGame = r.games ? r.pointsFor / r.games : 0;
  }
  return [...rows.values()].sort((a, b) => b.titles - a.titles || b.winPct - a.winPct || b.pointsPerGame - a.pointsPerGame);
}

// ---------------------------------------------------------------------------
// Head to head

export interface HeadToHead {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  games: HistoryGame[];
}

/** h2h[a][b]: a's record against b, regular season and playoffs */
export function headToHead(data: HistoryData): Record<string, Record<string, HeadToHead>> {
  const out: Record<string, Record<string, HeadToHead>> = {};
  const cell = (a: string, b: string) => {
    out[a] ??= {};
    out[a][b] ??= { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, games: [] };
    return out[a][b];
  };
  for (const g of data.games) {
    if (!countsForRecords(g)) continue;
    for (const [me, them, pf, pa] of [[g.a, g.b, g.pa, g.pb], [g.b, g.a, g.pb, g.pa]] as const) {
      const c = cell(me, them);
      c.games.push(g);
      c.pointsFor += pf;
      c.pointsAgainst += pa;
      if (pf > pa) c.wins++;
      else if (pf < pa) c.losses++;
      else c.ties++;
    }
  }
  return out;
}

export interface Rivalry {
  a: string;
  b: string;
  games: number;
  /** a's record */
  wins: number;
  losses: number;
  ties: number;
  /** a's average margin per game */
  margin: number;
}

/** Each pair of managers once, with the one who leads the series (more wins, then points) as a */
export function rivalries(data: HistoryData): Rivalry[] {
  const h2h = headToHead(data);
  const out: Rivalry[] = [];
  for (const [x, row] of Object.entries(h2h)) {
    for (const [y, c] of Object.entries(row)) {
      if (x >= y) continue;
      const xLeads = c.wins > c.losses || (c.wins === c.losses && c.pointsFor >= c.pointsAgainst);
      const lead = xLeads ? c : h2h[y][x];
      out.push({
        a: xLeads ? x : y,
        b: xLeads ? y : x,
        games: lead.games.length,
        wins: lead.wins,
        losses: lead.losses,
        ties: lead.ties,
        margin: (lead.pointsFor - lead.pointsAgainst) / lead.games.length,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Record book

export interface GameRecord {
  game: HistoryGame;
  /** The manager the record belongs to (the scorer, or the winner) */
  userId: string;
  value: number;
}

export interface SeasonRecord {
  season: string;
  userId: string;
  wins: number;
  losses: number;
  ties: number;
  pointsPerGame: number;
}

export interface RecordBook {
  highestScores: GameRecord[];
  lowestScores: GameRecord[];
  biggestBlowouts: GameRecord[];
  closestGames: GameRecord[];
  highestCombined: GameRecord[];
  mostPointsInLoss: GameRecord[];
  fewestPointsInWin: GameRecord[];
  bestSeasons: SeasonRecord[];
  worstSeasons: SeasonRecord[];
  mostPointsSeasons: SeasonRecord[];
  fewestPointsSeasons: SeasonRecord[];
}

export function recordBook(data: HistoryData, top = 5): RecordBook {
  const games = data.games.filter(countsForRecords);
  const sides = games.flatMap((g) => [
    { game: g, userId: g.a, pf: g.pa, pa: g.pb },
    { game: g, userId: g.b, pf: g.pb, pa: g.pa },
  ]);
  const winnerSide = (g: HistoryGame) => (g.pa >= g.pb ? { userId: g.a, pf: g.pa, pa: g.pb } : { userId: g.b, pf: g.pb, pa: g.pa });
  const take = <T,>(items: T[], key: (t: T) => number, desc: boolean) =>
    [...items].sort((x, y) => (desc ? key(y) - key(x) : key(x) - key(y))).slice(0, top);

  const decided = games.filter((g) => g.pa !== g.pb);
  // Season records: complete seasons' regular seasons only
  const complete = new Set(data.seasons.filter((s) => s.complete).map((s) => s.season));
  const seasonRows = new Map<string, SeasonRecord & { pf: number; games: number }>();
  for (const g of data.games) {
    if (g.kind !== 'regular' || !complete.has(g.season)) continue;
    for (const [me, pf, pa] of [[g.a, g.pa, g.pb], [g.b, g.pb, g.pa]] as const) {
      const key = `${g.season}:${me}`;
      const r = seasonRows.get(key) ?? { season: g.season, userId: me, wins: 0, losses: 0, ties: 0, pointsPerGame: 0, pf: 0, games: 0 };
      r.games++;
      r.pf += pf;
      if (pf > pa) r.wins++;
      else if (pf < pa) r.losses++;
      else r.ties++;
      r.pointsPerGame = r.pf / r.games;
      seasonRows.set(key, r);
    }
  }
  const seasons: SeasonRecord[] = [...seasonRows.values()].map((r) => ({
    season: r.season,
    userId: r.userId,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsPerGame: r.pointsPerGame,
  }));
  const pct = (r: SeasonRecord) => (r.wins + r.ties / 2) / Math.max(r.wins + r.losses + r.ties, 1);

  return {
    highestScores: take(sides, (s) => s.pf, true).map((s) => ({ game: s.game, userId: s.userId, value: s.pf })),
    lowestScores: take(sides, (s) => s.pf, false).map((s) => ({ game: s.game, userId: s.userId, value: s.pf })),
    biggestBlowouts: take(decided, (g) => Math.abs(g.pa - g.pb), true).map((g) => ({ game: g, userId: winnerSide(g).userId, value: Math.abs(g.pa - g.pb) })),
    closestGames: take(decided, (g) => Math.abs(g.pa - g.pb), false).map((g) => ({ game: g, userId: winnerSide(g).userId, value: Math.abs(g.pa - g.pb) })),
    highestCombined: take(games, (g) => g.pa + g.pb, true).map((g) => ({ game: g, userId: winnerSide(g).userId, value: g.pa + g.pb })),
    mostPointsInLoss: take(sides.filter((s) => s.pf < s.pa), (s) => s.pf, true).map((s) => ({ game: s.game, userId: s.userId, value: s.pf })),
    fewestPointsInWin: take(sides.filter((s) => s.pf > s.pa), (s) => s.pf, false).map((s) => ({ game: s.game, userId: s.userId, value: s.pf })),
    bestSeasons: take(seasons, (r) => pct(r) + r.pointsPerGame / 1e4, true),
    worstSeasons: take(seasons, (r) => pct(r) + r.pointsPerGame / 1e4, false),
    mostPointsSeasons: take(seasons, (r) => r.pointsPerGame, true),
    fewestPointsSeasons: take(seasons, (r) => r.pointsPerGame, false),
  };
}
