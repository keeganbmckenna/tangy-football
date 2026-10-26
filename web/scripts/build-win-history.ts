/**
 * Win-probability history for finished weeks: each matchup's live win odds replayed through
 * the week, every few minutes while games were on, with the Live tab's own model
 * (liveWinOdds in lib/analyze/live.ts).
 *
 * Reads the play-by-play timelines from scripts/build_play_timelines.py (each starter's points
 * after every play, every game's clock and score, the week's injury report) and the week's
 * matchups and pregame projections from Sleeper. Each starter's replayed points end exactly at
 * his official total: anything the play-by-play missed is added over his game.
 *
 *   npx tsx scripts/build-win-history.ts 2025 [--weeks 1 2 3 | --recent 2]
 *   npx tsx --env-file=.env.local scripts/build-win-history.ts 2026 --current
 *
 * Writes public/data/win-history/{season}/{week}.json. --current replays the week in progress
 * (scripts/build_play_timelines.py --current) into the live snapshots in Redis instead
 * (lib/liveHistory.ts), so its chart covers the games played before live saving caught them.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLEEPER_CONFIG } from '../lib/config';
import type { SleeperLeague, SleeperMatchup, TeamStats } from '../lib/types';
import { allowedPoints, gameRemaining, liveWinOdds, scoreSpread, type LiveGame } from '../lib/analyze/live';
import { allowedScoring, starterProjections } from '../lib/liveProjections';
import { replaceSnapshots } from '../lib/liveHistory';
import { teamsPlaying } from '../lib/oddsData';
import { biggestPlays, cleanPlay, type PlayEvent, type WinHistory } from '../lib/winHistory';

const HERE = dirname(fileURLToPath(import.meta.url));
const TIMELINES = join(HERE, '..', '..', 'scripts', 'cache', 'timelines');
const OUT = join(HERE, '..', 'public', 'data', 'win-history');
/** --diagnostics: also write each sample's projected finals and spread here, for research */
const DIAG = join(HERE, '..', '..', 'scripts', 'cache', 'live_diag');
const DIAGNOSTICS = process.argv.includes('--diagnostics');
/** Seconds between samples while games are on */
const STEP = 180;

interface Timeline {
  season: string;
  week: number;
  /** game ID -> teams and [time, quarter, seconds left in it, home score, away score] after each play */
  games: Record<string, { home: string; away: string; snaps: Array<[number, number, number, number, number]> }>;
  /** Sleeper ID -> [time, points so far] after each play that changed them */
  players: Record<string, Array<[number, number]>>;
  /** Team -> [time, defense points so far, apart from points allowed] */
  defense: Record<string, Array<[number, number]>>;
  injuries: Record<string, string>;
  /** Each starter's official points */
  final: Record<string, number>;
  /** [time, description, home team, away team] of each play that changed a starter's points */
  plays?: Array<[number, string, string?, string?]>;
}

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
};

async function leagueFor(season: string): Promise<SleeperLeague> {
  let league: SleeperLeague | null = await getJson(`${SLEEPER_CONFIG.baseUrl}/league/${SLEEPER_CONFIG.leagueId}`);
  while (league && league.season !== season) {
    const prev = league.previous_league_id;
    league = prev && prev !== '0' ? await getJson<SleeperLeague>(`${SLEEPER_CONFIG.baseUrl}/league/${prev}`) : null;
  }
  if (!league) throw new Error(`No league for ${season}`);
  return league;
}

/** The last entry at or before t (entries sorted by time), or null */
function at<T extends [number, ...unknown[]]>(series: T[] | undefined, t: number): T | null {
  if (!series?.length || series[0][0] > t) return null;
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  return series[lo];
}

async function buildWeek(league: SleeperLeague, week: number, scoring: Record<string, number>): Promise<WinHistory | null> {
  const path = join(TIMELINES, league.season, `${week}.json`);
  if (!existsSync(path)) {
    console.log(`${league.season} week ${week}: no timeline (run scripts/build_play_timelines.py), skipped`);
    return null;
  }
  const tl = JSON.parse(readFileSync(path, 'utf8')) as Timeline;
  const base = SLEEPER_CONFIG.baseUrl;
  const matchups = await getJson<SleeperMatchup[]>(`${base}/league/${league.league_id}/matchups/${week}`);
  const earlier = await Promise.all(
    Array.from({ length: week - 1 }, (_, i) => getJson<SleeperMatchup[]>(`${base}/league/${league.league_id}/matchups/${i + 1}`))
  );
  // The spread the Live tab would have used: from the weeks before this one
  const weekly = new Map<number, number[]>();
  for (const ms of earlier) for (const m of ms) weekly.set(m.roster_id, [...(weekly.get(m.roster_id) ?? []), m.points ?? 0]);
  const spread = scoreSpread([...weekly.values()].map((weeklyScores) => ({ weeklyScores }) as TeamStats), week - 1);

  // Each team's game: the plays' clock and score, from its own side
  const teamGame = new Map<string, { home: boolean; opponent: string; snaps: Timeline['games'][string]['snaps'] }>();
  for (const g of Object.values(tl.games)) {
    teamGame.set(g.home, { home: true, opponent: g.away, snaps: g.snaps });
    teamGame.set(g.away, { home: false, opponent: g.home, snaps: g.snaps });
  }
  // Teams that play this week but aren't in the play-by-play yet (the week in progress): not kicked off
  const scheduled = (await teamsPlaying(league.season))?.[week] ?? new Set<string>();
  const unplayed = [...scheduled].filter((t) => !teamGame.has(t));
  const pregame: Record<string, LiveGame> = Object.fromEntries(
    [...teamGame.keys(), ...unplayed].map((t) => [t, { state: 'pre', remaining: 1, label: '' } as LiveGame])
  );
  const projections = await starterProjections(league.season, week, week - 1, matchups, pregame, scoring, tl.injuries);
  if (!projections) throw new Error(`No projections for ${league.season} week ${week}`);
  const ptsAllowed = allowedScoring(scoring);

  // When each game was on, and the sample times: every STEP seconds while any game was
  const spans = Object.values(tl.games).map((g) => [g.snaps[0][0], g.snaps[g.snaps.length - 1][0]] as const);
  const times = new Set<number>([Math.min(...spans.map((s) => s[0])) - 60]);
  for (const [start, end] of spans) {
    for (let t = start; t < end; t += STEP) times.add(Math.round(t / STEP) * STEP);
    times.add(end);
  }
  const sampled = [...times].sort((a, b) => a - b);

  const gameAt = (team: string, t: number): LiveGame | null => {
    const g = teamGame.get(team);
    if (!g) return null;
    const first = g.snaps[0][0];
    const last = g.snaps[g.snaps.length - 1][0];
    if (t < first) return { state: 'pre', remaining: 1, label: '' };
    const snap = at(g.snaps, t)!;
    const [, quarter, clock, home, away] = snap;
    const [score, opponentScore] = g.home ? [home, away] : [away, home];
    if (t >= last) return { state: 'post', remaining: 0, label: 'Final', score, opponentScore };
    return { state: 'in', remaining: gameRemaining('in', quarter, clock, score - opponentScore), label: `Q${quarter}`, score, opponentScore };
  };
  // Share of a game played, for spreading each player's unexplained points over his game
  const played = (g: LiveGame | null) => (!g || g.state === 'pre' ? 0 : g.state === 'post' ? 1 : Math.min(1, Math.max(0, 1 - g.remaining)));

  const starterIds = [...new Set(matchups.flatMap((m) => (m.starters ?? []).filter((id) => id && id !== '0')))];
  const teamOf = (id: string) => projections[id]?.team ?? (/^[A-Z]{2,3}$/.test(id) ? id : null);
  const lastOf = <T extends [number, number]>(s: T[] | undefined) => (s?.length ? s[s.length - 1][1] : 0);
  // What the play-by-play explains of each starter's official total, and the gap
  const gap = new Map(
    starterIds.map((id) => {
      if (/^[A-Z]{2,3}$/.test(id)) {
        const g = teamGame.get(id);
        const allowedFinal = g ? (g.home ? g.snaps[g.snaps.length - 1][4] : g.snaps[g.snaps.length - 1][3]) : 0;
        return [id, (tl.final[id] ?? 0) - (lastOf(tl.defense[id]) + (g ? allowedPoints(allowedFinal, ptsAllowed) : 0))];
      }
      return [id, (tl.final[id] ?? 0) - lastOf(tl.players[id])];
    })
  );

  // Every starter's points and each matchup's odds at a moment
  const evaluate = (t: number) => {
    const games: Record<string, LiveGame> = {};
    for (const team of teamGame.keys()) games[team] = gameAt(team, t)!;
    for (const team of unplayed) games[team] = { state: 'pre', remaining: 1, label: '' };
    const allowed: Record<string, number> = {};
    const pointsAt = (id: string) => {
      const team = teamOf(id);
      const g = team ? games[team] ?? null : null;
      const spreadGap = (gap.get(id) ?? 0) * played(g);
      if (/^[A-Z]{2,3}$/.test(id)) {
        if (!g || g.state === 'pre') return 0;
        allowed[id] = g.opponentScore ?? 0;
        return (at(tl.defense[id], t)?.[1] ?? 0) + allowedPoints(allowed[id], ptsAllowed) + spreadGap;
      }
      return (at(tl.players[id], t)?.[1] ?? 0) + spreadGap;
    };
    const points = new Map<string, number>();
    const atT = matchups.map((m) => {
      const starters = (m.starters ?? []).filter((id) => id && id !== '0');
      const players_points = Object.fromEntries(starters.map((id) => [id, Math.round(pointsAt(id) * 100) / 100]));
      // For the big plays: a defense measured from its kickoff baseline, since starting in the
      // shutout bracket (10 points here) at kickoff isn't a play
      starters.forEach((id) => points.set(id, players_points[id] - (id in allowed ? allowedPoints(0, ptsAllowed) : 0)));
      return { ...m, players_points, points: starters.reduce((s, id) => s + players_points[id], 0) };
    });
    return { points, odds: liveWinOdds(atT, projections, games, spread, { allowed, allowedScoring: ptsAllowed }) };
  };

  const series = new Map<number, { a: number; b: number; odds: number[]; scores: Array<[number, number]>; events: PlayEvent[] }>();
  // For research (--diagnostics): each sample's projected finals and spread, per matchup
  const diag = new Map<number, Array<[number, number, number, number, number, number]>>();
  for (const t of sampled) {
    for (const o of evaluate(t).odds) {
      diag.set(o.matchupId, [...(diag.get(o.matchupId) ?? []), [t, o.a.score, o.b.score, o.a.projected, o.b.projected, o.sd]]);
      const s = series.get(o.matchupId) ?? { a: o.a.rosterId, b: o.b.rosterId, odds: [], scores: [], events: [] };
      s.odds.push(Math.round(o.aWinOdds * 1000) / 1000);
      s.scores.push([Math.round(o.a.score * 10) / 10, Math.round(o.b.score * 10) / 10]);
      series.set(o.matchupId, s);
    }
  }

  // Each play's effect in every matchup: starters' points and the odds just before and after it
  const startersOf = new Map(matchups.map((m) => [m.roster_id, (m.starters ?? []).filter((id) => id && id !== '0')]));
  const nameOf = (id: string) => {
    const name = projections[id]?.name ?? id;
    return projections[id]?.position === 'DEF' ? name : name.replace(/^(\S)\S*\s+(?=\S)/, '$1. ');
  };
  for (const [t, desc, home, away] of tl.plays ?? []) {
    // Only this play's game (another game's play at the same second isn't part of it), and a player
    // only if the play names him (two plays in one game can share a second); defenses go unnamed
    const text = desc.toLowerCase();
    const named = (id: string) => {
      if (/^[A-Z]{2,3}$/.test(id)) return true;
      const last = (projections[id]?.name ?? '').split(' ').filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).pop();
      return !last || text.includes(last.toLowerCase());
    };
    const inGame = (id: string) => (!home || teamOf(id) === home || teamOf(id) === away) && named(id);
    const before = evaluate(t - 1);
    const after = evaluate(t);
    for (const o of after.odds) {
      const s = series.get(o.matchupId);
      const prior = before.odds.find((x) => x.matchupId === o.matchupId);
      if (!s || !prior) continue;
      const players: PlayEvent['players'] = [];
      for (const [side, rosterId] of [['a', s.a], ['b', s.b]] as const) {
        for (const id of (startersOf.get(rosterId) ?? []).filter(inGame)) {
          const pts = Math.round(((after.points.get(id) ?? 0) - (before.points.get(id) ?? 0)) * 10) / 10;
          if (Math.abs(pts) >= 0.1) players.push({ side, name: nameOf(id), pts });
        }
      }
      if (!players.length) continue;
      s.events.push({ t, desc: cleanPlay(desc), players, before: Math.round(prior.aWinOdds * 1000) / 1000, after: Math.round(o.aWinOdds * 1000) / 1000 });
    }
  }
  for (const s of series.values()) s.events = biggestPlays(s.events);

  if (DIAGNOSTICS) {
    mkdirSync(join(DIAG, league.season), { recursive: true });
    writeFileSync(
      join(DIAG, league.season, `${week}.json`),
      JSON.stringify({ matchups: [...series.entries()].map(([id, s]) => ({ id, a: s.a, b: s.b, rows: diag.get(id) ?? [] })) })
    );
  }
  return {
    season: league.season,
    week,
    times: sampled,
    matchups: [...series.entries()].map(([matchupId, s]) => ({ matchupId, ...s })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--weeks');
  const r = args.indexOf('--recent');
  const current = args.includes('--current');
  const recent = r >= 0 ? Number(args[r + 1]) : null;
  const seasons = args.filter((a) => /^\d{4}$/.test(a));
  const onlyWeeks = i >= 0 ? args.slice(i + 1).filter((a) => /^\d{1,2}$/.test(a)).map(Number) : null;
  for (const season of seasons) {
    const league = await leagueFor(season);
    const scoring = league.scoring_settings ?? {};
    const last = league.settings?.last_scored_leg ?? 0;
    if (current) {
      const week = league.settings?.leg ?? 0;
      const history = week > last ? await buildWeek(league, week, scoring) : null;
      if (!history) {
        console.log(`${season}: no week in progress`);
        continue;
      }
      const saved = await replaceSnapshots(history);
      console.log(`${season} week ${week} (in progress): ${history.times.length} points ${saved ? 'saved to Redis' : 'NOT saved (no Redis credentials?)'}`);
      continue;
    }
    const all = Array.from({ length: last }, (_, k) => k + 1);
    for (const week of onlyWeeks ?? (recent ? all.slice(-recent) : all)) {
      const history = await buildWeek(league, week, scoring);
      if (!history) continue;
      mkdirSync(join(OUT, season), { recursive: true });
      writeFileSync(join(OUT, season, `${week}.json`), JSON.stringify(history));
      console.log(`${season} week ${week}: ${history.times.length} points, ${history.matchups.length} matchups`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
