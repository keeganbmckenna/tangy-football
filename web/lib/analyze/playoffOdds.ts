/**
 * Playoff picture for the regular season in progress:
 * - seeding "if the season ended now"
 * - simulated odds over the remaining schedule
 * - exact clinch / elimination logic and what each team needs
 *
 * Seeding: division winners take the top seeds (ordered by record), then wild
 * cards. Ties on record are broken by points for, which matches every past
 * Sleeper bracket in this league.
 *
 * Simulation model (fittedStrength; scripts/backtests/export_model.py, adopted under
 * scripts/backtests/PREREGISTRATION_2026.md): each player is worth a blend of his
 * projection for the week and his own season points per game (see playerValue). A
 * team's expected score is the league average so far, plus a weight on how far its
 * best lineup of those values (averaged over the remaining regular-season weeks)
 * sits from the league's, plus a weight on how far its points per game so far sit
 * from the league's; both weights were fitted for each week of the season on
 * thousands of other 12-team leagues. Each simulated season also gives each team one
 * random offset (the uncertainty that fit leaves, measured the same way), and each
 * week normal noise with the league's pooled week-to-week spread. Out of sample this
 * beat the earlier model (75% of the lineup gap, teamStrength) in 8 of 8 seasons.
 * teamStrength stays for the trade tools and as the fallback without projections.
 */
import strengthModel from './strengthModel.json';

export interface OddsTeam {
  rosterId: number;
  teamName: string;
  username: string;
  /** 0 when the league has no divisions */
  division: number;
  divisionName?: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface RemainingGame {
  week: number;
  a: number;
  b: number;
}

export interface PlayoffFormat {
  playoffTeams: number;
  hasDivisions: boolean;
  /** Seeds that skip the first round */
  byes: number;
}

// ---------------------------------------------------------------------------
// Display

/**
 * A simulated probability as a percentage. One decimal under 10% and over 90%,
 * where 20,000 runs measure it precisely and the difference matters (1.4% vs
 * 1.9%, 98.4% vs 99.6%); whole numbers in between, where a decimal would be
 * false precision. "0%"/"100%" only when it never/always happened.
 */
export function formatOdds(p: number): string {
  if (p <= 0) return '0%';
  if (p >= 1) return '100%';
  if (p < 0.001) return '<0.1%';
  if (p > 0.999) return '>99.9%';
  const v = p * 100;
  if (v < 10 || v > 90) {
    const r = Math.round(v * 10) / 10;
    // e.g. 9.96 rounds to 10.0: show it like the whole-number band
    if (r >= 10 && r <= 90) return `${Math.round(v)}%`;
    return `${r.toFixed(1)}%`;
  }
  return `${Math.round(v)}%`;
}

// ---------------------------------------------------------------------------
// Seeding

/** Record as a single number: ties count as half a win */
const recordValue = (t: { wins: number; ties: number }) => t.wins + t.ties / 2;

/**
 * Playoff seeds (roster IDs in seed order) and division winners for a set of
 * final records. Ties on record go to points for.
 */
export function seedTeams(teams: OddsTeam[], format: PlayoffFormat): { seeds: number[]; divisionWinners: Set<number> } {
  const ranked = [...teams].sort((a, b) => recordValue(b) - recordValue(a) || b.pointsFor - a.pointsFor);
  const divisionWinners = new Set<number>();
  if (format.hasDivisions) {
    const seen = new Set<number>();
    for (const t of ranked) {
      if (!seen.has(t.division)) {
        seen.add(t.division);
        divisionWinners.add(t.rosterId);
      }
    }
  }
  const winners = ranked.filter((t) => divisionWinners.has(t.rosterId));
  const rest = ranked.filter((t) => !divisionWinners.has(t.rosterId));
  const seeds = [...winners, ...rest].slice(0, format.playoffTeams).map((t) => t.rosterId);
  return { seeds, divisionWinners };
}

export interface ProjectedBracketGame {
  label: string;
  week: number;
  /** Seeds playing; null where it's the winner of an earlier game */
  top: { seed: number; rosterId: number } | { from: string };
  bottom: { seed: number; rosterId: number } | { from: string };
}

/**
 * This league's bracket: seeds 1-2 get byes, round 1 is 4 v 5 and 3 v 6, seed
 * 1 plays the 4/5 winner and seed 2 the 3/6 winner (no reseeding).
 */
export function projectedBracket(seeds: number[], playoffWeekStart: number): ProjectedBracketGame[] {
  if (seeds.length < 6) return [];
  const s = (n: number) => ({ seed: n, rosterId: seeds[n - 1] });
  return [
    { label: 'Round 1', week: playoffWeekStart, top: s(4), bottom: s(5) },
    { label: 'Round 1', week: playoffWeekStart, top: s(3), bottom: s(6) },
    { label: 'Semifinal', week: playoffWeekStart + 1, top: s(1), bottom: { from: 'Winner of 4 v 5' } },
    { label: 'Semifinal', week: playoffWeekStart + 1, top: s(2), bottom: { from: 'Winner of 3 v 6' } },
    { label: 'Final', week: playoffWeekStart + 2, top: { from: 'Winner of 1 v 4/5' }, bottom: { from: 'Winner of 2 v 3/6' } },
  ];
}

// ---------------------------------------------------------------------------
// Toilet bowl

/**
 * Toilet bowl seeds (roster IDs, seed 1 first) for the teams that missed the
 * playoffs: worst record first, ties on record going to the team with fewer
 * points for. Matches every past Sleeper losers bracket in this league.
 */
export function toiletSeeds(teams: OddsTeam[], playoffSeeds: number[]): number[] {
  const inPlayoffs = new Set(playoffSeeds);
  return teams
    .filter((t) => !inPlayoffs.has(t.rosterId))
    .sort((a, b) => recordValue(a) - recordValue(b) || a.pointsFor - b.pointsFor)
    .map((t) => t.rosterId);
}

/**
 * This league's toilet bowl: the lower score advances. Seeds 1-2 (the worst
 * two teams) get byes, round 1 is 4 v 5 and 3 v 6, seed 1 plays the 4/5 game's
 * lower scorer and seed 2 the 3/6 game's; the final's lower scorer is last.
 */
export function projectedToiletBracket(seeds: number[], playoffWeekStart: number): ProjectedBracketGame[] {
  if (seeds.length !== 6) return [];
  const s = (n: number) => ({ seed: n, rosterId: seeds[n - 1] });
  return [
    { label: 'Round 1', week: playoffWeekStart, top: s(4), bottom: s(5) },
    { label: 'Round 1', week: playoffWeekStart, top: s(3), bottom: s(6) },
    { label: 'Semifinal', week: playoffWeekStart + 1, top: s(1), bottom: { from: 'Lower score of 4 v 5' } },
    { label: 'Semifinal', week: playoffWeekStart + 1, top: s(2), bottom: { from: 'Lower score of 3 v 6' } },
    { label: 'Last-place game', week: playoffWeekStart + 2, top: { from: 'Lower score of 1 v 4/5' }, bottom: { from: 'Lower score of 2 v 3/6' } },
  ];
}

// ---------------------------------------------------------------------------
// Team strength

/** Positions each lineup slot accepts; anything else (K, DEF) accepts itself */
export const SLOT_POSITIONS: Record<string, string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};
const NON_STARTING = new Set(['BN', 'IR', 'TAXI']);

export interface LineupSlot {
  slot: string;
  playerId: string;
  points: number;
}

/** The best lineup a roster can start: each starting slot's player, most restrictive slots first */
export function bestLineup(
  players: string[],
  projections: Record<string, { position: string; points: number }>,
  rosterPositions: string[]
): { total: number; starters: LineupSlot[] } {
  const pool = players
    .filter((p) => projections[p])
    .map((p) => ({ id: p, ...projections[p] }))
    .sort((a, b) => b.points - a.points);
  const slots = rosterPositions
    .filter((s) => !NON_STARTING.has(s))
    .map((s) => ({ slot: s, eligible: SLOT_POSITIONS[s] ?? [s] }))
    .sort((a, b) => a.eligible.length - b.eligible.length);
  const used = new Set<string>();
  const starters: LineupSlot[] = [];
  let total = 0;
  for (const { slot, eligible } of slots) {
    const pick = pool.find((p) => !used.has(p.id) && eligible.includes(p.position));
    if (pick) {
      used.add(pick.id);
      total += pick.points;
      starters.push({ slot, playerId: pick.id, points: pick.points });
    }
  }
  return { total, starters };
}

/** Projected points of the best lineup a roster can start */
export function bestLineupPoints(
  players: string[],
  projections: Record<string, { position: string; points: number }>,
  rosterPositions: string[]
): number {
  return bestLineup(players, projections, rosterPositions).total;
}

export const PROJECTION_WEIGHT = 0.75;
const FORM_SHRINK_WEEKS = 2;
const MIN_SPREAD = 15;
const DEFAULT_SPREAD = 25;

/** Share of a player's value that comes from his season points per game */
export const SEASON_SHARE = 0.5;
/** Games of projection his season points per game are padded with, so a game or two can't swing it */
export const PLAYER_SHRINK_GAMES = 3;

/**
 * A player's expected points for a week: half his projection, half his season
 * points per game (padded toward the projection). A player projected for
 * nothing (bye, out) is worth nothing that week.
 */
export function playerValue(projection: number, seasonPoints: number, gamesPlayed: number): number {
  if (projection <= 0) return 0;
  const perGame = (seasonPoints + PLAYER_SHRINK_GAMES * projection) / (gamesPlayed + PLAYER_SHRINK_GAMES);
  return (1 - SEASON_SHARE) * projection + SEASON_SHARE * perGame;
}

/**
 * Expected score per team for each remaining week, and the week-to-week spread.
 * weeklyScores holds each team's completed-week scores; lineups (optional)
 * holds each team's best lineup of player values (playerValue) per remaining
 * week. Weeks without lineups fall back to the team's season scoring.
 */
/** League scoring so far and the pooled week-to-week spread */
function leagueLevel(weeklyScores: Record<number, number[]>): { league: number; spread: number } {
  const ids = Object.keys(weeklyScores).map(Number);
  const all = ids.flatMap((id) => weeklyScores[id]);
  const league = all.length ? all.reduce((s, v) => s + v, 0) / all.length : 100;
  let sq = 0;
  let n = 0;
  for (const id of ids) {
    const s = weeklyScores[id];
    if (!s.length) continue;
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    s.forEach((v) => (sq += (v - m) ** 2));
    n += s.length - 1;
  }
  return { league, spread: n > 0 ? Math.max(Math.sqrt(sq / n), MIN_SPREAD) : DEFAULT_SPREAD };
}

/** The fitted weights for a snapshot week (the first week not yet played), clamped to the weeks fitted */
export function fittedWeights(snapshotWeek: number): { lineup: number; ppg: number; tau: number } {
  const fitted = Object.keys(strengthModel.weeks).map(Number);
  const week = Math.min(Math.max(snapshotWeek, Math.min(...fitted)), Math.max(...fitted));
  return (strengthModel.weeks as Record<string, { lineup: number; ppg: number; tau: number }>)[String(week)];
}

/**
 * The fitted model: expected score per team (the same every remaining week, playoffs
 * included), the week-to-week spread and the persistent team spread (teamSpread, one draw
 * per team per simulated season). regularWeeks are the remaining regular-season weeks the
 * lineup is averaged over. Null without a lineup for every team in some regular week.
 */
export function fittedStrength(
  weeklyScores: Record<number, number[]>,
  weeks: number[],
  regularWeeks: number[],
  lineups: Record<number, Record<number, number>>,
  snapshotWeek: number
): { meanByWeek: Record<number, Record<number, number>>; spread: number; teamSpread: number; lineupWeight: number } | null {
  const ids = Object.keys(weeklyScores).map(Number);
  const full = regularWeeks.filter((w) => lineups[w] && ids.every((id) => lineups[w][id] !== undefined));
  if (!ids.length || !full.length) return null;
  const { league, spread } = leagueLevel(weeklyScores);
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const lineup = new Map(ids.map((id) => [id, avg(full.map((w) => lineups[w][id]))]));
  const ppg = new Map(ids.map((id) => [id, weeklyScores[id].length ? avg(weeklyScores[id]) : league]));
  const lineupMean = avg([...lineup.values()]);
  const ppgMean = avg([...ppg.values()]);
  const c = fittedWeights(snapshotWeek);
  const meanByWeek: Record<number, Record<number, number>> = {};
  for (const week of weeks) {
    meanByWeek[week] = Object.fromEntries(
      ids.map((id) => [id, league + c.lineup * (lineup.get(id)! - lineupMean) + c.ppg * (ppg.get(id)! - ppgMean)])
    );
  }
  return { meanByWeek, spread, teamSpread: c.tau, lineupWeight: c.lineup };
}

type SingleGameWeights = { lineup: number; ppg: number; sd: number };

/**
 * Single-game weights for a snapshot week and a game weeksAhead away (1 = next week),
 * clamped to the weeks and horizons fitted (scripts/backtests/single_games.py, model E)
 */
export function singleGameWeights(snapshotWeek: number, weeksAhead: number): SingleGameWeights {
  const fitted = strengthModel.singleGame.weeks as Record<string, Record<string, SingleGameWeights>>;
  const weeks = Object.keys(fitted).map(Number);
  const byAhead = fitted[String(Math.min(Math.max(snapshotWeek, Math.min(...weeks)), Math.max(...weeks)))];
  const horizons = Object.keys(byAhead).map(Number);
  return byAhead[String(Math.min(Math.max(weeksAhead, 1), Math.max(...horizons)))];
}

/** Single-game model: each team's expected margin per week (relative to the league), the spread, and the weight on that week's lineup */
export interface GameModel {
  meanByWeek: Record<number, Record<number, number>>;
  spreadByWeek: Record<number, number>;
  lineupWeightByWeek: Record<number, number>;
}

/**
 * Single games, fitted for a single week's score rather than the rest of the season: a team's
 * score in a week is the league's plus the week's lineup weight times its lineup gap that week
 * plus a weight on its points-per-game gap, with that week's spread. Next week's lineup counts
 * heavily (about 0.8: byes, injuries and pickups are already in it); further out, points per
 * game takes over. Out of sample it beat the earlier model's single-game odds next week and 2-4
 * weeks ahead (single_games.py). Null without a lineup for every team in some remaining week.
 */
export function singleGameModel(
  weeklyScores: Record<number, number[]>,
  regularWeeks: number[],
  lineups: Record<number, Record<number, number>>,
  lastScoredWeek: number
): GameModel | null {
  const ids = Object.keys(weeklyScores).map(Number);
  const weeks = regularWeeks.filter((w) => lineups[w] && ids.every((id) => lineups[w][id] !== undefined));
  if (!ids.length || !weeks.length) return null;
  const { league } = leagueLevel(weeklyScores);
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const ppg = new Map(ids.map((id) => [id, weeklyScores[id].length ? avg(weeklyScores[id]) : league]));
  const ppgMean = avg([...ppg.values()]);
  const model: GameModel = { meanByWeek: {}, spreadByWeek: {}, lineupWeightByWeek: {} };
  for (const w of weeks) {
    const c = singleGameWeights(lastScoredWeek + 1, w - lastScoredWeek);
    const lineupMean = avg(ids.map((id) => lineups[w][id]));
    model.meanByWeek[w] = Object.fromEntries(ids.map((id) => [id, c.lineup * (lineups[w][id] - lineupMean) + c.ppg * (ppg.get(id)! - ppgMean)]));
    model.spreadByWeek[w] = c.sd;
    model.lineupWeightByWeek[w] = c.lineup;
  }
  return model;
}

export function teamStrength(
  weeklyScores: Record<number, number[]>,
  weeks: number[],
  lineups: Record<number, Record<number, number>> | null
): { meanByWeek: Record<number, Record<number, number>>; spread: number } {
  const ids = Object.keys(weeklyScores).map(Number);
  const { league, spread } = leagueLevel(weeklyScores);

  const form: Record<number, number> = {};
  for (const id of ids) {
    const s = weeklyScores[id];
    form[id] = (s.reduce((a, b) => a + b, 0) + FORM_SHRINK_WEEKS * league) / (s.length + FORM_SHRINK_WEEKS);
  }

  const meanByWeek: Record<number, Record<number, number>> = {};
  for (const week of weeks) {
    const lineup = lineups?.[week];
    const useLineups = !!lineup && ids.length > 0 && ids.every((id) => lineup[id] !== undefined);
    const lineupMean = useLineups ? ids.reduce((s, id) => s + lineup![id], 0) / ids.length : 0;
    meanByWeek[week] = {};
    for (const id of ids) {
      // Centered on the league's scoring level, so only relative strength counts
      meanByWeek[week][id] = useLineups ? league + PROJECTION_WEIGHT * (lineup![id] - lineupMean) : form[id];
    }
  }
  return { meanByWeek, spread };
}

// ---------------------------------------------------------------------------
// Simulation

/** Small seeded RNG (mulberry32) so odds don't jitter between renders */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
}

/** A team's power ranking: the model's expected weekly score and how sure its rank is */
export interface TeamStrength {
  /** Expected weekly score (the fitted model's, before the persistent team uncertainty) */
  mean: number;
  /** Rank by mean (1 = strongest) */
  rank: number;
  /** 80% interval of its rank, with each team's strength drawn mean + tau * z */
  rankLow: number;
  rankHigh: number;
}

/**
 * Power rankings from the model: teams ranked by expected weekly score, with an 80% interval
 * on each rank from the model's own uncertainty in true strength (tau, the persistent team
 * spread): in each draw every team's strength is mean + tau * z, and the teams are re-ranked.
 */
export function strengthRanks(means: Record<number, number>, tau: number, sims = 4000, seed = 2026): Record<number, TeamStrength> {
  const ids = Object.keys(means).map(Number);
  const order = [...ids].sort((a, b) => means[b] - means[a]);
  const ranks = new Map(ids.map((id) => [id, [] as number[]]));
  const normal = rng(seed);
  for (let s = 0; s < (tau > 0 ? sims : 1); s++) {
    const drawn = ids.map((id) => ({ id, v: means[id] + tau * normal() })).sort((a, b) => b.v - a.v);
    drawn.forEach((d, i) => ranks.get(d.id)!.push(i + 1));
  }
  const quantile = (v: number[], q: number) => {
    const sorted = [...v].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  };
  return Object.fromEntries(
    order.map((id, i) => [id, { mean: means[id], rank: i + 1, rankLow: quantile(ranks.get(id)!, 0.1), rankHigh: quantile(ranks.get(id)!, 0.9) }])
  );
}

/** Odds of each outcome, given some condition (e.g. winning this week) */
export interface OutcomeOdds {
  playoffs: number;
  division: number;
  bye: number;
  /** null if the playoffs aren't simulated */
  champion: number | null;
  /** Losing the toilet bowl; null if the toilet bowl isn't simulated */
  lastPlace: number | null;
  /** Toilet bowl seed 1 or 2 (one of the two worst teams); null if no toilet bowl */
  toiletBye: number | null;
}

export interface TeamOdds {
  rosterId: number;
  playoffs: number;
  division: number;
  bye: number;
  /** seedOdds[i] = chance of finishing as seed i + 1 */
  seedOdds: number[];
  /** Every outcome's odds after a win / loss in the next remaining week (null if no game) */
  ifWin: OutcomeOdds | null;
  ifLoss: OutcomeOdds | null;
  /** Chance of losing the toilet bowl final (null if the toilet bowl isn't simulated) */
  lastPlace: number | null;
  /** Chance of winning the championship (null if the playoffs aren't simulated) */
  champion: number | null;
  /** Chance of a toilet bowl bye: seed 1 or 2, the two worst teams (null if no toilet bowl) */
  toiletBye: number | null;
  /** Average wins over the remaining regular-season games */
  expectedWins: number;
}

export interface GameImpact {
  week: number;
  a: number;
  b: number;
  /** For each roster: playoff odds if a wins, if b wins */
  ifAWins: Record<number, number>;
  ifBWins: Record<number, number>;
}

export interface OddsResult {
  teams: Record<number, TeamOdds>;
  nextWeekGames: GameImpact[];
  sims: number;
}

export function simulatePlayoffOdds(
  teams: OddsTeam[],
  remaining: RemainingGame[],
  format: PlayoffFormat,
  meanByWeek: Record<number, Record<number, number>>,
  spread: number,
  sims = 20000,
  seed = 2026,
  /**
   * First playoff week. When set, the 6-team playoff bracket is played out for
   * championship odds, and (if toiletBowl) the 6-team toilet bowl for last place.
   */
  playoffWeekStart?: number,
  toiletBowl = true,
  /** Persistent team uncertainty: one normal offset per team per simulated season (fittedStrength) */
  teamSpread = 0,
  /**
   * Results to hold fixed (the what-if picker): remaining-game index -> the roster that wins it.
   * Both teams still score from the model; the picked team gets the higher of the two scores.
   */
  forced?: Record<number, number>
): OddsResult {
  const normal = rng(seed);
  const ids = teams.map((t) => t.rosterId);
  const simulateChampion = playoffWeekStart !== undefined && format.playoffTeams === 6 && format.byes === 2;
  const simulateToilet = playoffWeekStart !== undefined && toiletBowl && ids.length - format.playoffTeams === 6;
  // A team's expected score in a week, falling back to its average strength
  const avgMean = new Map(
    ids.map((id) => {
      const vals = Object.values(meanByWeek).map((m) => m[id]).filter((v) => v !== undefined);
      return [id, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0];
    })
  );
  const meanFor = (week: number, id: number) => meanByWeek[week]?.[id] ?? avgMean.get(id)!;
  let offset: Map<number, number> | null = null;
  const score = (week: number, id: number) => meanFor(week, id) + (offset?.get(id) ?? 0) + spread * normal();
  const lastPlace = new Map(ids.map((id) => [id, 0]));
  const champion = new Map(ids.map((id) => [id, 0]));
  const toiletBye = new Map(ids.map((id) => [id, 0]));
  const nextWeek = remaining.length ? Math.min(...remaining.map((g) => g.week)) : null;
  const nextGames = remaining.filter((g) => g.week === nextWeek);

  const playoffs = new Map(ids.map((id) => [id, 0]));
  const division = new Map(ids.map((id) => [id, 0]));
  const bye = new Map(ids.map((id) => [id, 0]));
  const seedCounts = new Map(ids.map((id) => [id, new Array(format.playoffTeams).fill(0)]));
  // Next-week conditionals: [game][a won? 0 : 1] -> per-outcome counts per roster, plus sims per branch
  type Counts = Record<keyof OutcomeOdds, Map<number, number>>;
  const newCounts = (): Counts => ({
    playoffs: new Map(ids.map((id) => [id, 0])),
    division: new Map(ids.map((id) => [id, 0])),
    bye: new Map(ids.map((id) => [id, 0])),
    champion: new Map(ids.map((id) => [id, 0])),
    lastPlace: new Map(ids.map((id) => [id, 0])),
    toiletBye: new Map(ids.map((id) => [id, 0])),
  });
  const branch = nextGames.map(() => [newCounts(), newCounts()]);
  const branchN = nextGames.map(() => [0, 0]);
  const bump = (m: Map<number, number>, id: number) => m.set(id, m.get(id)! + 1);

  const winTotals = new Map(ids.map((id) => [id, 0]));
  for (let s = 0; s < sims; s++) {
    if (teamSpread > 0) offset = new Map(ids.map((id) => [id, teamSpread * normal()]));
    const sim = teams.map((t) => ({ ...t }));
    const byId = new Map(sim.map((t) => [t.rosterId, t]));
    const nextWinners: boolean[] = [];
    for (let gi = 0; gi < remaining.length; gi++) {
      const g = remaining[gi];
      const a = byId.get(g.a);
      const b = byId.get(g.b);
      if (!a || !b) continue;
      let sa = score(g.week, g.a);
      let sb = score(g.week, g.b);
      const winner = forced?.[gi];
      if ((winner === g.a && sa < sb) || (winner === g.b && sb < sa)) [sa, sb] = [sb, sa];
      a.pointsFor += sa;
      b.pointsFor += sb;
      if (sa > sb) {
        a.wins++;
        b.losses++;
        winTotals.set(g.a, winTotals.get(g.a)! + 1);
      } else {
        b.wins++;
        a.losses++;
        winTotals.set(g.b, winTotals.get(g.b)! + 1);
      }
      if (g.week === nextWeek) nextWinners.push(sa > sb);
    }
    const { seeds, divisionWinners } = seedTeams(sim, format);
    seeds.forEach((id, i) => {
      playoffs.set(id, playoffs.get(id)! + 1);
      seedCounts.get(id)![i]++;
      if (i < format.byes) bye.set(id, bye.get(id)! + 1);
    });
    divisionWinners.forEach((id) => division.set(id, division.get(id)! + 1));
    let champ: number | null = null;
    let last: number | null = null;
    let toiletByes: number[] = [];
    if (simulateChampion) {
      // Higher score advances: 4 v 5 and 3 v 6, then 1 and 2 host, then the final
      const w = playoffWeekStart!;
      const higher = (week: number, a: number, b: number) => (score(week, a) > score(week, b) ? a : b);
      const r1a = higher(w, seeds[3], seeds[4]);
      const r1b = higher(w, seeds[2], seeds[5]);
      champ = higher(w + 2, higher(w + 1, seeds[0], r1a), higher(w + 1, seeds[1], r1b));
      bump(champion, champ);
    }
    if (simulateToilet) {
      // Lower score advances; the final's lower scorer finishes last
      const t = toiletSeeds(sim, seeds);
      toiletByes = [t[0], t[1]];
      toiletByes.forEach((id) => bump(toiletBye, id));
      const w = playoffWeekStart!;
      const lower = (week: number, a: number, b: number) => (score(week, a) < score(week, b) ? a : b);
      const r1a = lower(w, t[3], t[4]);
      const r1b = lower(w, t[2], t[5]);
      last = lower(w + 2, lower(w + 1, t[0], r1a), lower(w + 1, t[1], r1b));
      bump(lastPlace, last);
    }
    nextWinners.forEach((aWon, gi) => {
      const side = aWon ? 0 : 1;
      branchN[gi][side]++;
      const c = branch[gi][side];
      seeds.forEach((id, i) => {
        bump(c.playoffs, id);
        if (i < format.byes) bump(c.bye, id);
      });
      divisionWinners.forEach((id) => bump(c.division, id));
      if (champ !== null) bump(c.champion, champ);
      if (last !== null) bump(c.lastPlace, last);
      toiletByes.forEach((id) => bump(c.toiletBye, id));
    });
  }

  const nextWeekGames: GameImpact[] = nextGames.map((g, gi) => {
    const ifAWins: Record<number, number> = {};
    const ifBWins: Record<number, number> = {};
    ids.forEach((id) => {
      ifAWins[id] = branchN[gi][0] ? branch[gi][0].playoffs.get(id)! / branchN[gi][0] : 0;
      ifBWins[id] = branchN[gi][1] ? branch[gi][1].playoffs.get(id)! / branchN[gi][1] : 0;
    });
    return { week: g.week, a: g.a, b: g.b, ifAWins, ifBWins };
  });

  // Every outcome's odds for a roster in one branch of a next-week game
  const branchOdds = (gi: number, side: number, id: number): OutcomeOdds => {
    const n = branchN[gi][side] || 1;
    const c = branch[gi][side];
    return {
      playoffs: c.playoffs.get(id)! / n,
      division: format.hasDivisions ? c.division.get(id)! / n : 0,
      bye: c.bye.get(id)! / n,
      champion: simulateChampion ? c.champion.get(id)! / n : null,
      lastPlace: simulateToilet ? c.lastPlace.get(id)! / n : null,
      toiletBye: simulateToilet ? c.toiletBye.get(id)! / n : null,
    };
  };

  const result: Record<number, TeamOdds> = {};
  for (const id of ids) {
    const gi = nextGames.findIndex((g) => g.a === id || g.b === id);
    const own = gi >= 0 ? nextGames[gi] : null;
    result[id] = {
      rosterId: id,
      playoffs: playoffs.get(id)! / sims,
      division: format.hasDivisions ? division.get(id)! / sims : 0,
      bye: bye.get(id)! / sims,
      seedOdds: seedCounts.get(id)!.map((c) => c / sims),
      // Branch 0 is "a won"
      ifWin: own ? branchOdds(gi, own.a === id ? 0 : 1, id) : null,
      ifLoss: own ? branchOdds(gi, own.a === id ? 1 : 0, id) : null,
      lastPlace: simulateToilet ? lastPlace.get(id)! / sims : null,
      champion: simulateChampion ? champion.get(id)! / sims : null,
      toiletBye: simulateToilet ? toiletBye.get(id)! / sims : null,
      expectedWins: winTotals.get(id)! / sims,
    };
  }
  return { teams: result, nextWeekGames, sims };
}

// ---------------------------------------------------------------------------
// Exact scenarios: clinched, eliminated, what each team needs

type Status = 'in' | 'out' | 'points';

/**
 * Whether team x makes the playoffs / wins its division given final wins
 * (record values), when points-for tiebreaks can go either way. 'points' means
 * it depends on the tiebreaker.
 */
export function statusFor(
  x: number,
  record: Map<number, number>,
  division: Map<number, number>,
  format: PlayoffFormat
): { playoffs: Status; division: Status } {
  const xr = record.get(x)!;
  const evaluate = (worst: boolean) => {
    const ahead = (r: number) => (worst ? r >= xr : r > xr);
    // Division title
    let wonDivision = false;
    if (format.hasDivisions) {
      wonDivision = true;
      record.forEach((r, id) => {
        if (id !== x && division.get(id) === division.get(x) && ahead(r)) wonDivision = false;
      });
    }
    if (wonDivision) return { inPlayoffs: true, wonDivision };
    // Non-division-winners finishing ahead of x: in each division, every team
    // ahead of x except that division's winner (always among them if any are)
    const aheadByDiv = new Map<number, number>();
    record.forEach((r, id) => {
      if (id !== x && ahead(r)) {
        const d = format.hasDivisions ? division.get(id)! : 0;
        aheadByDiv.set(d, (aheadByDiv.get(d) ?? 0) + 1);
      }
    });
    let aheadNonWinners = 0;
    aheadByDiv.forEach((count) => (aheadNonWinners += format.hasDivisions ? count - 1 : count));
    const divisions = format.hasDivisions ? new Set(division.values()).size : 0;
    const wildCards = format.playoffTeams - divisions;
    return { inPlayoffs: aheadNonWinners < wildCards, wonDivision };
  };
  const worst = evaluate(true);
  const best = evaluate(false);
  const combine = (w: boolean, b: boolean): Status => (w ? 'in' : b ? 'points' : 'out');
  return {
    playoffs: combine(worst.inPlayoffs, best.inPlayoffs),
    division: format.hasDivisions ? combine(worst.wonDivision, best.wonDivision) : 'out',
  };
}

/** Exact enumeration only while this many games remain (2^18 = 262,144 outcomes) */
export const MAX_ENUMERATED_GAMES = 18;

export interface TeamScenarios {
  rosterId: number;
  /** Exact: every remaining result was checked */
  exact: boolean;
  clinchedPlayoffs: boolean;
  eliminated: boolean;
  clinchedDivision: boolean;
  eliminatedFromDivision: boolean;
  /** Winning every remaining game guarantees a spot (exact mode only) */
  winOutAndIn: boolean | null;
  /** Winning out leaves it to points for at worst (exact mode only) */
  winOutPointsAtWorst: boolean | null;
  winOutAndDivision: boolean | null;
  /** If winning out isn't enough: single other results that would make it enough */
  helpNeeded: { winner: number; loser: number; week: number }[];
}

export function playoffScenarios(teams: OddsTeam[], remaining: RemainingGame[], format: PlayoffFormat): Record<number, TeamScenarios> {
  const ids = teams.map((t) => t.rosterId);
  const base = new Map(teams.map((t) => [t.rosterId, recordValue(t)]));
  const division = new Map(teams.map((t) => [t.rosterId, t.division]));
  const games = remaining.filter((g) => base.has(g.a) && base.has(g.b));
  const result: Record<number, TeamScenarios> = {};

  if (games.length <= MAX_ENUMERATED_GAMES) {
    // Index-based for speed: up to 2^18 outcomes x 12 teams
    const T = ids.length;
    const idx = new Map(ids.map((id, i) => [id, i]));
    const baseArr = ids.map((id) => base.get(id)!);
    const divArr = ids.map((id) => division.get(id)!);
    const divisions = format.hasDivisions ? new Set(divArr).size : 0;
    const wildCards = format.playoffTeams - divisions;
    const ga = games.map((g) => idx.get(g.a)!);
    const gb = games.map((g) => idx.get(g.b)!);
    const G = games.length;
    // Status bit flags: 1 = in, 2 = out, 4 = depends on points
    const IN = 1, OUT = 2, PTS = 4;
    const pFlags = new Uint8Array(T), dFlags = new Uint8Array(T);
    const winOutP = new Uint8Array(T), winOutD = new Uint8Array(T);
    const help = new Uint8Array(T * G * 2); // [x][game][a won? 0 : 1]
    // Games each team plays, as bit masks over game index, and which side it's on
    const playsMask = new Array(T).fill(0), sideAMask = new Array(T).fill(0);
    games.forEach((_, i) => {
      playsMask[ga[i]] |= 1 << i; sideAMask[ga[i]] |= 1 << i;
      playsMask[gb[i]] |= 1 << i;
    });
    const rec = new Float64Array(T);
    const aheadCount = new Int32Array(64);
    const status = (x: number, worst: boolean): [boolean, boolean] => {
      const xr = rec[x];
      let wonDiv = format.hasDivisions;
      for (let j = 0; j < T; j++) {
        if (j !== x && divArr[j] === divArr[x] && (worst ? rec[j] >= xr : rec[j] > xr)) { wonDiv = false; break; }
      }
      if (wonDiv) return [true, true];
      aheadCount.fill(0);
      let ahead = 0;
      for (let j = 0; j < T; j++) {
        if (j !== x && (worst ? rec[j] >= xr : rec[j] > xr)) {
          ahead++;
          if (format.hasDivisions) aheadCount[divArr[j]]++;
        }
      }
      let nonWinners = ahead;
      if (format.hasDivisions) for (let d = 0; d < 64; d++) if (aheadCount[d] > 0) nonWinners--;
      return [nonWinners < wildCards, false];
    };
    const total = 1 << G;
    for (let mask = 0; mask < total; mask++) {
      for (let j = 0; j < T; j++) rec[j] = baseArr[j];
      for (let i = 0; i < G; i++) rec[mask & (1 << i) ? ga[i] : gb[i]]++;
      for (let x = 0; x < T; x++) {
        const [wIn, wDiv] = status(x, true);
        const [bIn, bDiv] = status(x, false);
        const p = wIn ? IN : bIn ? PTS : OUT;
        const d = !format.hasDivisions ? OUT : wDiv ? IN : bDiv ? PTS : OUT;
        pFlags[x] |= p; dFlags[x] |= d;
        // x won all its games: its side bit set where it's team a, clear where team b
        const won = (mask & playsMask[x]) === sideAMask[x];
        if (won) {
          winOutP[x] |= p; winOutD[x] |= d;
          for (let i = 0; i < G; i++) {
            if (playsMask[x] & (1 << i)) continue;
            help[(x * G + i) * 2 + (mask & (1 << i) ? 0 : 1)] |= p;
          }
        }
      }
    }
    for (let x = 0; x < T; x++) {
      const helpNeeded: TeamScenarios['helpNeeded'] = [];
      const winOutAndIn = winOutP[x] === IN;
      if (!winOutAndIn && pFlags[x] !== OUT) {
        for (let i = 0; i < G; i++) {
          for (let side = 0; side < 2; side++) {
            if (help[(x * G + i) * 2 + side] === IN) {
              const winner = side === 0 ? games[i].a : games[i].b;
              helpNeeded.push({ winner, loser: side === 0 ? games[i].b : games[i].a, week: games[i].week });
            }
          }
        }
      }
      result[ids[x]] = {
        rosterId: ids[x],
        exact: true,
        clinchedPlayoffs: pFlags[x] === IN,
        eliminated: pFlags[x] === OUT,
        clinchedDivision: format.hasDivisions && dFlags[x] === IN,
        eliminatedFromDivision: format.hasDivisions && dFlags[x] === OUT,
        winOutAndIn,
        winOutPointsAtWorst: !winOutAndIn && (winOutP[x] & OUT) === 0,
        winOutAndDivision: format.hasDivisions ? winOutD[x] === IN : null,
        helpNeeded: helpNeeded.sort((p, q) => p.week - q.week),
      };
    }
    return result;
  }

  // Too many games to enumerate: safe bounds that ignore who plays whom.
  // Clinched: in even if x loses out and everyone else wins out.
  // Eliminated: out even if x wins out and everyone else loses out.
  const gamesLeft = new Map(ids.map((id) => [id, games.filter((g) => g.a === id || g.b === id).length]));
  for (const x of ids) {
    const worst = new Map(ids.map((id) => [id, base.get(id)! + (id === x ? 0 : gamesLeft.get(id)!)]));
    const best = new Map(ids.map((id) => [id, base.get(id)! + (id === x ? gamesLeft.get(id)! : 0)]));
    const w = statusFor(x, worst, division, format);
    const b = statusFor(x, best, division, format);
    result[x] = {
      rosterId: x,
      exact: false,
      clinchedPlayoffs: w.playoffs === 'in',
      eliminated: b.playoffs === 'out',
      clinchedDivision: format.hasDivisions && w.division === 'in',
      eliminatedFromDivision: format.hasDivisions && b.division === 'out',
      winOutAndIn: null,
      winOutPointsAtWorst: null,
      winOutAndDivision: null,
      helpNeeded: [],
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Points-for races at the playoff line

export interface PointsRace {
  /** The team on the other side of the line with the same record */
  rival: number;
  /** Positive: x is ahead on points */
  margin: number;
  /** 'cutoff' = last spot in vs first out; 'division' = division lead */
  kind: 'cutoff' | 'division';
}

/**
 * Teams level on record across the playoff line or a division lead, where
 * points for currently decides who's in.
 */
export function pointsRaces(teams: OddsTeam[], format: PlayoffFormat): Record<number, PointsRace[]> {
  const { seeds, divisionWinners } = seedTeams(teams, format);
  const byId = new Map(teams.map((t) => [t.rosterId, t]));
  const out: Record<number, PointsRace[]> = {};
  const add = (x: number, race: PointsRace) => (out[x] ??= []).push(race);

  // Division leads decided on points
  if (format.hasDivisions) {
    divisionWinners.forEach((leaderId) => {
      const leader = byId.get(leaderId)!;
      teams
        .filter((t) => t.rosterId !== leaderId && t.division === leader.division && recordValue(t) === recordValue(leader))
        .forEach((t) => {
          add(leaderId, { rival: t.rosterId, margin: leader.pointsFor - t.pointsFor, kind: 'division' });
          add(t.rosterId, { rival: leaderId, margin: t.pointsFor - leader.pointsFor, kind: 'division' });
        });
    });
  }

  // Last team in vs teams out with the same record
  const lastIn = byId.get(seeds[seeds.length - 1]);
  if (lastIn && !divisionWinners.has(lastIn.rosterId)) {
    teams
      .filter((t) => !seeds.includes(t.rosterId) && recordValue(t) === recordValue(lastIn))
      .forEach((t) => {
        add(lastIn.rosterId, { rival: t.rosterId, margin: lastIn.pointsFor - t.pointsFor, kind: 'cutoff' });
        add(t.rosterId, { rival: lastIn.rosterId, margin: t.pointsFor - lastIn.pointsFor, kind: 'cutoff' });
      });
  }
  return out;
}

// ---------------------------------------------------------------------------
// API response

export interface PlayoffOddsResponse {
  status: 'in_progress' | 'complete' | 'not_started';
  season: string;
  lastScoredWeek: number;
  regularSeasonEnd: number;
  playoffWeekStart: number;
  format: PlayoffFormat;
  teams: OddsTeam[];
  /** Roster IDs in seed order if the season ended now */
  seeds: number[];
  /** Toilet bowl seeds if the season ended now (worst team first) */
  toiletSeeds: number[];
  toiletBracket: ProjectedBracketGame[];
  divisionWinners: number[];
  bracket: ProjectedBracketGame[];
  odds: OddsResult | null;
  /**
   * The earlier model's odds (teamStrength, lineup weight 0.75), logged next to the fitted
   * model's for the 2026 head-to-head (scripts/backtests/PREREGISTRATION_2026.md); not shown
   */
  previousModel: Record<number, { playoffs: number; bye: number; champion: number | null }> | null;
  scenarios: Record<number, TeamScenarios>;
  pointsRaces: Record<number, PointsRace[]>;
  /**
   * Each remaining regular-season game's odds under the single-game model (singleGameModel, as
   * the trade tools' weekly odds): aWins is a's chance. Null without projections.
   */
  gameOdds: Array<{ week: number; a: number; b: number; aWins: number }> | null;
  /** Power rankings from the fitted model (strengthRanks); null without projections */
  strength: Record<number, TeamStrength> | null;
  /**
   * What the playoff simulation runs on, for the what-if picker to re-run it in the browser
   * with some results fixed (remaining is in the same order as gameOdds)
   */
  model: {
    remaining: RemainingGame[];
    meanByWeek: Record<number, Record<number, number>>;
    spread: number;
    teamSpread: number;
  } | null;
  remainingWeeks: number;
  /** Remaining weeks that had projections; empty if season form only */
  projectionWeeks: number[];
  generatedAt: string;
}
