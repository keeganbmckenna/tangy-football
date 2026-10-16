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
 * Simulation model (backtested on 2022-2025, see the commit that added this
 * file): each team's weekly score is normal around a strength that blends 75%
 * its projected best lineup with 25% its season scoring (shrunk toward the
 * league average), with the league's pooled week-to-week spread. The backtest
 * used next week's projection for every remaining week; live, each remaining
 * week uses that week's projection, so bye weeks only count when they happen.
 */

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
const SLOT_POSITIONS: Record<string, string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};
const NON_STARTING = new Set(['BN', 'IR', 'TAXI']);

/** Projected points of the best lineup a roster can start */
export function bestLineupPoints(
  players: string[],
  projections: Record<string, { position: string; points: number }>,
  rosterPositions: string[]
): number {
  const pool = players
    .filter((p) => projections[p])
    .map((p) => ({ id: p, ...projections[p] }))
    .sort((a, b) => b.points - a.points);
  const slots = rosterPositions
    .filter((s) => !NON_STARTING.has(s))
    .map((s) => SLOT_POSITIONS[s] ?? [s])
    .sort((a, b) => a.length - b.length);
  const used = new Set<string>();
  let total = 0;
  for (const eligible of slots) {
    const pick = pool.find((p) => !used.has(p.id) && eligible.includes(p.position));
    if (pick) {
      used.add(pick.id);
      total += pick.points;
    }
  }
  return total;
}

export const PROJECTION_WEIGHT = 0.75;
const FORM_SHRINK_WEEKS = 2;
const MIN_SPREAD = 15;
const DEFAULT_SPREAD = 25;

/**
 * Expected score per team for each remaining week, and the week-to-week spread.
 * weeklyScores holds each team's completed-week scores; projections (optional)
 * holds each team's projected best lineup per remaining week.
 */
export function teamStrength(
  weeklyScores: Record<number, number[]>,
  weeks: number[],
  projections: Record<number, Record<number, number>> | null
): { meanByWeek: Record<number, Record<number, number>>; spread: number } {
  const ids = Object.keys(weeklyScores).map(Number);
  const all = ids.flatMap((id) => weeklyScores[id]);
  const league = all.length ? all.reduce((s, v) => s + v, 0) / all.length : 100;

  // Pooled within-team spread
  let sq = 0;
  let n = 0;
  for (const id of ids) {
    const s = weeklyScores[id];
    if (!s.length) continue;
    const m = s.reduce((a, b) => a + b, 0) / s.length;
    s.forEach((v) => (sq += (v - m) ** 2));
    n += s.length - 1;
  }
  const spread = n > 0 ? Math.max(Math.sqrt(sq / n), MIN_SPREAD) : DEFAULT_SPREAD;

  const form: Record<number, number> = {};
  for (const id of ids) {
    const s = weeklyScores[id];
    form[id] = (s.reduce((a, b) => a + b, 0) + FORM_SHRINK_WEEKS * league) / (s.length + FORM_SHRINK_WEEKS);
  }

  const meanByWeek: Record<number, Record<number, number>> = {};
  for (const week of weeks) {
    const proj = projections?.[week];
    const useProj = !!proj && ids.length > 0 && ids.every((id) => proj[id] !== undefined);
    const projMean = useProj ? ids.reduce((s, id) => s + proj![id], 0) / ids.length : 0;
    meanByWeek[week] = {};
    for (const id of ids) {
      // Projections centered on the league's scoring level, so only relative strength counts
      meanByWeek[week][id] = useProj
        ? PROJECTION_WEIGHT * (league + proj![id] - projMean) + (1 - PROJECTION_WEIGHT) * form[id]
        : form[id];
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

export interface TeamOdds {
  rosterId: number;
  playoffs: number;
  division: number;
  bye: number;
  /** seedOdds[i] = chance of finishing as seed i + 1 */
  seedOdds: number[];
  /** Playoff odds after a win / loss in the next remaining week (null if no game) */
  ifWin: number | null;
  ifLoss: number | null;
  /** Chance of losing the toilet bowl final (null if the toilet bowl isn't simulated) */
  lastPlace: number | null;
  /** Chance of winning the championship (null if the playoffs aren't simulated) */
  champion: number | null;
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
  sims = 10000,
  seed = 2026,
  /**
   * First playoff week. When set, the 6-team playoff bracket is played out for
   * championship odds, and (if toiletBowl) the 6-team toilet bowl for last place.
   */
  playoffWeekStart?: number,
  toiletBowl = true
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
  const score = (week: number, id: number) => meanFor(week, id) + spread * normal();
  const lastPlace = new Map(ids.map((id) => [id, 0]));
  const champion = new Map(ids.map((id) => [id, 0]));
  const nextWeek = remaining.length ? Math.min(...remaining.map((g) => g.week)) : null;
  const nextGames = remaining.filter((g) => g.week === nextWeek);

  const playoffs = new Map(ids.map((id) => [id, 0]));
  const division = new Map(ids.map((id) => [id, 0]));
  const bye = new Map(ids.map((id) => [id, 0]));
  const seedCounts = new Map(ids.map((id) => [id, new Array(format.playoffTeams).fill(0)]));
  // Next-week conditionals: [game][a won?][roster] -> playoff count, plus sims per branch
  const branchIn = nextGames.map(() => [new Map(ids.map((id) => [id, 0])), new Map(ids.map((id) => [id, 0]))]);
  const branchN = nextGames.map(() => [0, 0]);

  for (let s = 0; s < sims; s++) {
    const sim = teams.map((t) => ({ ...t }));
    const byId = new Map(sim.map((t) => [t.rosterId, t]));
    const nextWinners: boolean[] = [];
    for (const g of remaining) {
      const a = byId.get(g.a);
      const b = byId.get(g.b);
      if (!a || !b) continue;
      const sa = score(g.week, g.a);
      const sb = score(g.week, g.b);
      a.pointsFor += sa;
      b.pointsFor += sb;
      if (sa > sb) {
        a.wins++;
        b.losses++;
      } else {
        b.wins++;
        a.losses++;
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
    if (simulateChampion) {
      // Higher score advances: 4 v 5 and 3 v 6, then 1 and 2 host, then the final
      const w = playoffWeekStart!;
      const higher = (week: number, a: number, b: number) => (score(week, a) > score(week, b) ? a : b);
      const r1a = higher(w, seeds[3], seeds[4]);
      const r1b = higher(w, seeds[2], seeds[5]);
      const champ = higher(w + 2, higher(w + 1, seeds[0], r1a), higher(w + 1, seeds[1], r1b));
      champion.set(champ, champion.get(champ)! + 1);
    }
    if (simulateToilet) {
      // Lower score advances; the final's lower scorer finishes last
      const t = toiletSeeds(sim, seeds);
      const w = playoffWeekStart!;
      const lower = (week: number, a: number, b: number) => (score(week, a) < score(week, b) ? a : b);
      const r1a = lower(w, t[3], t[4]);
      const r1b = lower(w, t[2], t[5]);
      const last = lower(w + 2, lower(w + 1, t[0], r1a), lower(w + 1, t[1], r1b));
      lastPlace.set(last, lastPlace.get(last)! + 1);
    }
    nextWinners.forEach((aWon, gi) => {
      const side = aWon ? 0 : 1;
      branchN[gi][side]++;
      seeds.forEach((id) => branchIn[gi][side].set(id, branchIn[gi][side].get(id)! + 1));
    });
  }

  const nextWeekGames: GameImpact[] = nextGames.map((g, gi) => {
    const ifAWins: Record<number, number> = {};
    const ifBWins: Record<number, number> = {};
    ids.forEach((id) => {
      ifAWins[id] = branchN[gi][0] ? branchIn[gi][0].get(id)! / branchN[gi][0] : 0;
      ifBWins[id] = branchN[gi][1] ? branchIn[gi][1].get(id)! / branchN[gi][1] : 0;
    });
    return { week: g.week, a: g.a, b: g.b, ifAWins, ifBWins };
  });

  const result: Record<number, TeamOdds> = {};
  for (const id of ids) {
    const own = nextWeekGames.find((g) => g.a === id || g.b === id);
    result[id] = {
      rosterId: id,
      playoffs: playoffs.get(id)! / sims,
      division: format.hasDivisions ? division.get(id)! / sims : 0,
      bye: bye.get(id)! / sims,
      seedOdds: seedCounts.get(id)!.map((c) => c / sims),
      ifWin: own ? (own.a === id ? own.ifAWins[id] : own.ifBWins[id]) : null,
      ifLoss: own ? (own.a === id ? own.ifBWins[id] : own.ifAWins[id]) : null,
      lastPlace: simulateToilet ? lastPlace.get(id)! / sims : null,
      champion: simulateChampion ? champion.get(id)! / sims : null,
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
  scenarios: Record<number, TeamScenarios>;
  pointsRaces: Record<number, PointsRace[]>;
  remainingWeeks: number;
  /** Remaining weeks that had projections; empty if season form only */
  projectionWeeks: number[];
  generatedAt: string;
}
