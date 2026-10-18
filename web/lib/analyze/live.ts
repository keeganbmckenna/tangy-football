/**
 * Live (in-progress week) views: play-all at the current scores and standings
 * as if the week ended now.
 */

import type { DivisionStanding, LeagueData, SleeperMatchup, TeamStats, WeeklyPlayAllRecord, WildCardStanding } from '../types';
import { calculateTeamStats, rankTeams } from './teamStats';
import { calculateDivisionStandings, calculateWildCardStandings } from './playoffs';
import { calculateWeeklyPlayAll } from './playEveryone';
import { normalCdf } from './trade';

/** Response of /api/live */
export interface LiveWeekData {
  season: string;
  /** Sleeper's current week */
  week: number;
  lastScoredWeek: number;
  playoffWeekStart: number;
  matchups: SleeperMatchup[];
  /** This week's projection and NFL team for each player in the matchups (missing if projections are unavailable) */
  projections?: Record<string, LiveProjection>;
  /** Each NFL team's game this week, by Sleeper team code (missing if the scoreboard is unavailable) */
  games?: Record<string, LiveGame>;
  fetchedAt: string;
}

/** Response of /api/live/scores: the fast-changing part, polled during games */
export interface LiveScoresData {
  week: number;
  matchups: SleeperMatchup[];
  games?: Record<string, LiveGame>;
  fetchedAt: string;
}

export interface LiveProjection {
  /** Projected half-PPR points, already zero for players ruled out and cut for doubtful ones */
  points: number;
  /** Spread of the player's weekly scores, as a share of his projection (see playerSpreadRatio) */
  spreadRatio: number;
  team: string | null;
  name: string;
  position: string;
  injury: string | null;
}

export interface LiveGame {
  state: 'pre' | 'in' | 'post';
  /** Share of a regulation game still to play, 0-1, plus the expected overtime */
  remaining: number;
  /** How the game stands, e.g. "Q3 5:21", "Final", "Sun 1:00 PM" */
  label: string;
}

/** Injury statuses that mean a player won't play (or play on), and how much a doubtful one is expected to play */
const RULED_OUT = new Set(['Out', 'IR', 'PUP', 'Sus', 'NA', 'DNR', 'COV']);
const DOUBTFUL_SHARE = 0.3;

/** A starter's expected points for the week given his injury status (doubtful only matters before kickoff) */
export function injuryAdjusted(points: number, status: string | null, gameStarted: boolean): number {
  if (status && RULED_OUT.has(status)) return 0;
  if (status === 'Doubtful' && !gameStarted) return points * DOUBTFUL_SHARE;
  return points;
}

// Overtime: about 1 regular-season game in 18 reaches it. The period is up to 10 minutes but
// most end sooner: in 2022-2025's 63 overtime games (ESPN play-by-play), the average minutes
// still to come after each full minute played, from kickoff to 9 minutes in. Few end in the
// first minutes (the first drive takes time) and only 3 ran the full 10.
const FULL_GAME_MARGIN_SD = 13.5;
const TIE_BAND = 1.9;
const OT_MINUTES_LEFT = [6.46, 5.55, 4.72, 3.96, 3.22, 2.55, 1.97, 1.61, 1.39, 0.93, 0];

/** Expected share of a game still to come in an overtime with this many seconds on its clock */
function overtimeRemaining(clock: number): number {
  const played = Math.min(10, Math.max(0, (600 - clock) / 60));
  const i = Math.min(9, Math.floor(played));
  const left = OT_MINUTES_LEFT[i] + (OT_MINUTES_LEFT[i + 1] - OT_MINUTES_LEFT[i]) * (played - i);
  // Never more than the clock allows
  return Math.min(left, clock / 60) / 60;
}

/**
 * Share of an NFL game still to play from its quarter, clock (seconds left in the period) and
 * score margin, counting the chance of overtime: likelier the closer the game and the less
 * time is left, so a tie late in the 4th quarter adds real time while a blowout adds none.
 */
export function gameRemaining(state: LiveGame['state'], period: number, clock: number, margin: number): number {
  if (state === 'post') return 0;
  if (period > 4) return overtimeRemaining(Math.max(0, clock));
  const regulation = state === 'pre' ? 1 : Math.min(1, Math.max(0, ((4 - period) * 900 + clock) / 3600));
  // The final margin spreads out with the time left; overtime happens when it lands on a tie
  const sd = FULL_GAME_MARGIN_SD * Math.sqrt(regulation);
  const tie = sd > 0.5 ? Math.min(0.9, (TIE_BAND * Math.exp(-0.5 * (margin / sd) ** 2)) / (sd * Math.sqrt(2 * Math.PI))) : margin === 0 ? 1 : 0;
  return regulation + tie * overtimeRemaining(600);
}

/**
 * Weekly half-PPR scores' spread as a share of the mean, by position, for a player with little
 * history: the median among 2025's regular contributors (8+ games), defenses rounded up since
 * theirs ranged widely
 */
export const POSITION_SPREAD_RATIO: Record<string, number> = { QB: 0.45, RB: 0.6, WR: 0.6, TE: 0.65, K: 0.55, DEF: 0.6 };
const SPREAD_PRIOR_GAMES = 4;

/**
 * How boom-or-bust a player is: his weekly scores' spread over their mean this season,
 * blended with his position's typical ratio (weighted as SPREAD_PRIOR_GAMES games) since a
 * handful of games says little on its own.
 */
export function playerSpreadRatio(position: string, scores: number[]): number {
  const prior = POSITION_SPREAD_RATIO[position] ?? 0.75;
  const n = scores.length;
  if (n < 2) return prior;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  if (mean <= 1) return prior;
  const sd = Math.sqrt(scores.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  return (n * Math.min(sd / mean, 2) + SPREAD_PRIOR_GAMES * prior) / (n + SPREAD_PRIOR_GAMES);
}

/**
 * A whole game's spread for one team at kickoff, as a share of the league's week-to-week
 * spread: fitted on 2022-2025's matchups with Sleeper's pre-kickoff projections
 * (scripts/backtests/live_pregame.py)
 */
export const LIVE_SPREAD_SCALE = 0.7;

export interface LiveSide {
  rosterId: number;
  score: number;
  /** Current score plus what the starters still to play are projected to add */
  projected: number;
  /** Starters whose games haven't started */
  toPlay: number;
  /** Starters whose games are in progress */
  playing: number;
}

export interface LiveMatchupOdds {
  matchupId: number;
  a: LiveSide;
  b: LiveSide;
  /** Chance a wins (ties split evenly) */
  aWinOdds: number;
}

export interface LiveStarter {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  injury: string | null;
  /** Points so far this week */
  points: number;
  /** Points so far plus what's still expected */
  projected: number;
  game: LiveGame | null;
}

/** A matchup side's starters in lineup order (or, with bench, its bench players), each with points so far and projected final */
export function liveLineup(
  m: SleeperMatchup,
  projections: Record<string, LiveProjection>,
  games: Record<string, LiveGame>,
  bench = false
): Array<LiveStarter | null> {
  const ids = bench ? (m.players ?? []).filter((id) => !(m.starters ?? []).includes(id)) : m.starters ?? [];
  return ids.map((id) => {
    // An empty slot
    if (!id || id === '0') return null;
    const p = projections[id];
    const game = p?.team ? games[p.team] ?? null : null;
    const points = m.players_points?.[id] ?? 0;
    // Defenses' IDs are their team codes (one on bye has no projection to name it)
    const defense = !p && /^[A-Z]{2,3}$/.test(id);
    return {
      playerId: id,
      name: p?.name ?? (defense ? `${id} Defense` : id),
      position: p?.position ?? (defense ? 'DEF' : ''),
      team: p?.team ?? (defense ? id : null),
      injury: p?.injury ?? null,
      points,
      projected: points + (p ? p.points * (game ? game.remaining : 0) : 0),
      game,
    };
  });
}

/**
 * A player's fantasy points from his raw stats and the league's scoring settings: each
 * stat times its setting (Sleeper's own formula; it matched every rostered player's
 * official points in a checked week).
 */
export function leaguePoints(stats: Record<string, number>, scoring: Record<string, number>): number {
  let total = 0;
  for (const [k, v] of Object.entries(stats)) if (scoring[k] !== undefined && typeof v === 'number') total += v * scoring[k];
  return Math.round(total * 100) / 100;
}

/**
 * Matchups with every player's points recomputed from fresher live stats (Sleeper refreshes
 * stats twice as often as matchup scores), and each team's score as its starters' total.
 * Players without stats yet keep Sleeper's points.
 */
export function withLivePoints(
  matchups: SleeperMatchup[],
  stats: Record<string, Record<string, number>>,
  scoring: Record<string, number>
): SleeperMatchup[] {
  return matchups.map((m) => {
    const players_points = { ...(m.players_points ?? {}) };
    for (const id of m.players ?? []) if (stats[id]) players_points[id] = leaguePoints(stats[id], scoring);
    const starters = (m.starters ?? []).filter((id) => id && id !== '0');
    const points = Math.round(starters.reduce((t, id) => t + (players_points[id] ?? 0), 0) * 100) / 100;
    return { ...m, players_points, points };
  });
}

/** Pooled week-to-week spread of team scores over completed weeks (the playoff odds model's spread) */
export function scoreSpread(teams: TeamStats[], throughWeek: number): number {
  let sq = 0;
  let n = 0;
  for (const t of teams) {
    const s = t.weeklyScores.slice(0, throughWeek).filter((v) => v > 0);
    if (s.length < 2) continue;
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    s.forEach((v) => (sq += (v - m) ** 2));
    n += s.length - 1;
  }
  return n > 0 ? Math.max(Math.sqrt(sq / n), 15) : 25;
}

/**
 * Live win odds for each real matchup. Each starter still to play adds his projection times
 * the share of his NFL game left (overtime included), and his own boom-or-bust spread over
 * that share. Player spreads are scaled so an average lineup before kickoff has the model's
 * single-week spread, so steadier lineups get tighter odds and volatile ones wider, and the
 * odds settle as games finish.
 */
export function liveWinOdds(
  matchups: SleeperMatchup[],
  projections: Record<string, LiveProjection>,
  games: Record<string, LiveGame>,
  spread: number
): LiveMatchupOdds[] {
  const starters = (m: SleeperMatchup) =>
    (m.starters ?? []).filter((id) => id !== '0' && projections[id]).map((id) => ({ p: projections[id], g: projections[id].team ? games[projections[id].team!] : undefined }));

  // Calibrate: the average lineup's whole-game variance should match the model's spread
  const fullVariance = (spread * LIVE_SPREAD_SCALE) ** 2;
  const lineupVariance = matchups.map((m) => starters(m).reduce((v, { p }) => v + (p.spreadRatio * p.points) ** 2, 0)).filter((v) => v > 0);
  const scale = lineupVariance.length ? fullVariance / (lineupVariance.reduce((a, b) => a + b, 0) / lineupVariance.length) : 1;

  const side = (m: SleeperMatchup) => {
    let left = 0;
    let variance = 0;
    let toPlay = 0;
    let playing = 0;
    for (const { p, g } of starters(m)) {
      // No game this week (a bye or a free agent): nothing more to come
      const remaining = g ? g.remaining : 0;
      left += p.points * remaining;
      variance += scale * (p.spreadRatio * p.points) ** 2 * remaining;
      if (g?.state === 'pre') toPlay++;
      else if (g?.state === 'in') playing++;
    }
    const score = m.points ?? 0;
    return { s: { rosterId: m.roster_id, score, projected: score + left, toPlay, playing }, variance };
  };
  const byId = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    if (m.matchup_id == null) continue;
    byId.set(m.matchup_id, [...(byId.get(m.matchup_id) ?? []), m]);
  }
  const out: LiveMatchupOdds[] = [];
  for (const [matchupId, pair] of byId) {
    if (pair.length !== 2) continue;
    const [a, b] = pair.map(side);
    const diff = a.s.projected - b.s.projected;
    const sd = Math.sqrt(a.variance + b.variance);
    const aWinOdds = sd > 0.01 ? normalCdf(diff / sd) : diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
    out.push({ matchupId, a: a.s, b: b.s, aWinOdds });
  }
  return out.sort((x, y) => x.matchupId - y.matchupId);
}

/**
 * The week in progress, or null when none is: Sleeper's current week once it's
 * past the last scored week, during the regular season.
 */
export function liveWeekNumber(week: number, lastScoredWeek: number, regularSeasonEnd: number): number | null {
  if (week <= 0 || week <= lastScoredWeek || week > regularSeasonEnd) return null;
  return week;
}

/**
 * Live result of a real matchup at the current scores. Equal scores,
 * including two teams both still at 0, are a tie.
 */
export function liveResult(score: number, opponentScore: number): 'W' | 'L' | 'T' {
  return score > opponentScore ? 'W' : score < opponentScore ? 'L' : 'T';
}

/** League data with the given week's matchups replaced by live ones */
export function withLiveMatchups(data: LeagueData, week: number, matchups: SleeperMatchup[]): LeagueData {
  return { ...data, matchups: { ...data.matchups, [week]: matchups } };
}

export interface LiveMatchupStatus {
  rosterId: number;
  score: number;
  opponentRosterId: number | null;
  opponentScore: number | null;
  /** Currently ahead, behind or level in the real matchup */
  result: 'W' | 'L' | 'T' | null;
}

/** Each roster's real matchup at the current scores */
export function liveMatchupStatus(matchups: SleeperMatchup[]): Map<number, LiveMatchupStatus> {
  const byId = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    if (m.matchup_id == null) continue;
    byId.set(m.matchup_id, [...(byId.get(m.matchup_id) ?? []), m]);
  }
  const status = new Map<number, LiveMatchupStatus>();
  for (const m of matchups) {
    const opp = m.matchup_id == null
      ? undefined
      : byId.get(m.matchup_id)?.find((o) => o.roster_id !== m.roster_id);
    const score = m.points ?? 0;
    const oppScore = opp ? opp.points ?? 0 : null;
    status.set(m.roster_id, {
      rosterId: m.roster_id,
      score,
      opponentRosterId: opp?.roster_id ?? null,
      opponentScore: oppScore,
      result: oppScore === null ? null : liveResult(score, oppScore),
    });
  }
  return status;
}

export interface LivePlayAllRow {
  team: TeamStats;
  score: number;
  /** This week's record against every other team at the current scores */
  week: WeeklyPlayAllRecord;
  /** Season play-all through this week, counting the live week as if final */
  seasonWins: number;
  seasonLosses: number;
  seasonTies: number;
  seasonWinPct: number;
}

/**
 * Play-all for the live week. teams must come from league data that includes
 * the live week's matchups (see withLiveMatchups). Sorted by current score.
 */
export function livePlayAll(teams: TeamStats[], week: number): LivePlayAllRow[] {
  return calculateWeeklyPlayAll(teams, week)
    .filter((row) => row.weeklyRecords[week - 1] !== undefined)
    .map((row) => {
      const team = teams.find((t) => t.username === row.username)!;
      const record = row.weeklyRecords[week - 1];
      const score = team.weeklyScores[week - 1] ?? 0;
      const opponent = team.weeklyOpponentScores[week - 1];
      return {
        team,
        score,
        week: { ...record, actualResult: opponent === undefined ? null : liveResult(score, opponent) },
        seasonWins: row.totalWins,
        seasonLosses: row.totalLosses,
        seasonTies: row.totalTies,
        seasonWinPct: row.overallWinPct,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export type PlayoffStatus = 'division' | 'wildcard' | 'in' | 'out';

export interface LiveStandingRow {
  /** Team as it would stand if the week ended now */
  team: TeamStats;
  before: { rank: number; wins: number; losses: number; ties: number; status: PlayoffStatus };
  now: { rank: number; wins: number; losses: number; ties: number; status: PlayoffStatus };
  liveResult: 'W' | 'L' | 'T' | null;
}

export interface LiveStandings {
  rows: LiveStandingRow[];
  /** As if the week ended now, same shape as the Overview tab's standings */
  standings: TeamStats[];
  divisions: DivisionStanding[];
  wildCard: WildCardStanding[];
}

/**
 * Playoff picture for ranked teams, built the same way as the Overview tab:
 * division leaders, then the wild card race among everyone else.
 */
function playoffPicture(teams: TeamStats[], playoffTeams: number, hasDivisions: boolean) {
  const status = new Map<number, PlayoffStatus>();
  if (!hasDivisions) {
    teams.forEach((t) => status.set(t.rosterId, t.standing <= playoffTeams ? 'in' : 'out'));
    return { status, divisions: [] as DivisionStanding[], wildCard: [] as WildCardStanding[] };
  }
  const divisions = calculateDivisionStandings(teams);
  const wildCard = calculateWildCardStandings(teams, playoffTeams);
  teams.forEach((t) => status.set(t.rosterId, t.isDivisionLeader ? 'division' : 'out'));
  wildCard.forEach((w) => {
    if (w.isIn) status.set(w.team.rosterId, 'wildcard');
  });
  return { status, divisions, wildCard };
}

/**
 * Standings before the live week and as if it ended at the current scores.
 * teams must come from league data that includes the live week's matchups;
 * their wins/losses/points (from Sleeper roster settings) don't include it yet.
 */
export function liveStandings(
  teams: TeamStats[],
  week: number,
  playoffTeams: number,
  hasDivisions: boolean
): LiveStandings {
  // Copies, since ranking and playoff calculations mutate teams
  const before = rankTeams(teams.map((t) => ({ ...t })));
  const beforeStatus = playoffPicture(before, playoffTeams, hasDivisions).status;

  const now = rankTeams(
    teams.map((t) => {
      const score = t.weeklyScores[week - 1] ?? 0;
      const opponent = t.weeklyOpponentScores[week - 1];
      const result = opponent === undefined ? null : liveResult(score, opponent);
      return {
        ...t,
        wins: t.wins + (result === 'W' ? 1 : 0),
        losses: t.losses + (result === 'L' ? 1 : 0),
        ties: t.ties + (result === 'T' ? 1 : 0),
        totalPoints: t.totalPoints + score,
      };
    })
  );
  const picture = playoffPicture(now, playoffTeams, hasDivisions);
  const nowStatus = picture.status;

  const beforeById = new Map(before.map((t) => [t.rosterId, t]));
  const rows = now.map((t) => {
    const b = beforeById.get(t.rosterId)!;
    return {
      team: t,
      before: { rank: b.standing, wins: b.wins, losses: b.losses, ties: b.ties, status: beforeStatus.get(t.rosterId)! },
      now: { rank: t.standing, wins: t.wins, losses: t.losses, ties: t.ties, status: nowStatus.get(t.rosterId)! },
      liveResult: (() => {
        const opponent = t.weeklyOpponentScores[week - 1];
        return opponent === undefined ? null : liveResult(t.weeklyScores[week - 1] ?? 0, opponent);
      })(),
    };
  });
  return { rows, standings: now, divisions: picture.divisions, wildCard: picture.wildCard };
}

/** Team stats including the live week's scores (wins/losses still pre-week) */
export function liveTeamStats(data: LeagueData, live: LiveWeekData): TeamStats[] {
  return calculateTeamStats(withLiveMatchups(data, live.week, live.matchups), live.lastScoredWeek);
}
