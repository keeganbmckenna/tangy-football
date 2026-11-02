/**
 * The win-probability history of the week in progress: each matchup's live win odds saved
 * every 30 seconds at most while games are on (lib/liveSave.ts, from the live routes the Live tab
 * polls and a workflow pings during game windows), in Upstash Redis through its HTTP API (no connection to open per request).
 * The "How it swung" chart reads it back until the week's play-by-play replay
 * (lib/winHistory.ts) replaces it.
 *
 * Needs KV_REST_API_URL and KV_REST_API_TOKEN, set by Vercel's Upstash integration
 * (web/.env.local for local runs); without them saving and reading do nothing.
 */

import type { LiveMatchupOdds } from '@/lib/analyze/live';
import { BIG_PLAYS_KEPT, biggestPlays, cleanPlay, dropRetractions, liveMoments, playersInPlay, type GamePlays, type LiveState, type PlayEvent, type WinHistory } from '@/lib/winHistory';

/** At most one snapshot per this many seconds (a big moment covers what changed in between) */
const EVERY_SECONDS = 30;
/** Kept this long: the play-by-play replay takes over within the week */
const KEEP_SECONDS = 45 * 24 * 3600;

const REST_URL = process.env.KV_REST_API_URL;
const REST_TOKEN = process.env.KV_REST_API_TOKEN;

export const liveHistoryEnabled = () => !!REST_URL && !!REST_TOKEN;

/** Run Redis commands in one round trip (Upstash's pipeline); null without Redis or on any failure */
async function redis(commands: Array<Array<string | number>>, timeoutMs = 3000): Promise<unknown[] | null> {
  if (!liveHistoryEnabled()) return null;
  try {
    const res = await fetch(`${REST_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REST_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    return out.some((r) => r.error) ? null : out.map((r) => r.result);
  } catch {
    return null;
  }
}

const key = (season: string, week: number) => `win:${season}:${week}`;

/** One saved moment: time (Unix seconds) and [matchupId, a, b, a's odds, a's score, b's score] per matchup */
interface Snapshot {
  t: number;
  m: Array<[number, number, number, number, number, number]>;
}

/** One matchup's starters by side, for spotting big moments between saves */
export interface MatchupStarters {
  matchupId: number;
  a: string[];
  b: string[];
}

/** What a save records: the odds now, and for big moments each starter's points */
export interface SaveInput {
  odds: LiveMatchupOdds[];
  live?: {
    pts: Record<string, number>;
    starters: MatchupStarters[];
    nameOf: (id: string) => string;
    /** A starter's NFL team (a defense's is its ID) */
    teamOf: (id: string) => string | null;
    /** The play-by-play of these teams' games so far, by team */
    plays: (teams: string[]) => Promise<GamePlays>;
    /** Each matchup's a odds with these starters' points taken away from now */
    oddsWithout: (points: Record<string, number>) => Record<number, number>;
  };
}

/**
 * Save the matchups' odds now, unless a snapshot was saved in the last EVERY_SECONDS, along
 * with any big moments since the last save (liveEvents). Given a function, it's only called once
 * this request has the save, so working out the odds costs one request per interval.
 */
export async function saveSnapshot(season: string, week: number, input: SaveInput | (() => Promise<SaveInput | null>)): Promise<boolean> {
  if (!liveHistoryEnabled()) return false;
  if (typeof input !== 'function' && !input.odds.length) return false;
  const k = key(season, week);
  // The lock decides who saves: SET NX with an expiry lets one request through per interval
  const lock = await redis([['SET', `${k}:lock`, '1', 'NX', 'EX', EVERY_SECONDS - 5], ['GET', `${k}:state`]]);
  if (lock?.[0] !== 'OK') return false;
  const built = typeof input === 'function' ? await input().catch(() => null) : input;
  if (!built?.odds.length) return false;
  const { odds, live } = built;
  const t = Math.round(Date.now() / 1000);
  const snapshot: Snapshot = {
    t,
    m: odds.map((o) => [o.matchupId, o.a.rosterId, o.b.rosterId, Math.round(o.aWinOdds * 1000) / 1000, Math.round(o.a.score * 10) / 10, Math.round(o.b.score * 10) / 10]),
  };
  const commands: Array<Array<string | number>> = [
    ['RPUSH', k, JSON.stringify(snapshot)],
    ['EXPIRE', k, KEEP_SECONDS],
  ];
  if (live) {
    const prev = typeof lock[1] === 'string' ? (JSON.parse(lock[1]) as LiveState) : null;
    let state: LiveState = { t, pts: live.pts, odds: live.oddsWithout({}), played: {} };
    let events: Array<{ matchupId: number; event: PlayEvent }> = [];
    if (prev) {
      // Only the games of starters whose points moved
      const moved = Object.keys(live.pts).filter((id) => Math.abs(live.pts[id] - (prev.pts[id] ?? 0)) >= 0.1);
      const teams = [...new Set(moved.map(live.teamOf).filter((x): x is string => !!x))];
      const plays = await live.plays(teams).catch(() => ({}));
      ({ events, state } = liveMoments(prev, { t, pts: live.pts }, live.starters, { nameOf: live.nameOf, teamOf: live.teamOf, plays, oddsWithout: live.oddsWithout }));
    }
    if (events.length) commands.push(['RPUSH', `${k}:events`, ...events.map((e) => JSON.stringify(e))], ['EXPIRE', `${k}:events`, KEEP_SECONDS]);
    commands.push(['SET', `${k}:state`, JSON.stringify(state), 'EX', KEEP_SECONDS]);
  }
  return !!(await redis(commands));
}

/** The week's saved snapshots as a win history (null without Redis or snapshots) */
export async function readSnapshots(season: string, week: number): Promise<WinHistory | null> {
  const res = await redis([
    ['LRANGE', key(season, week), 0, -1],
    ['LRANGE', `${key(season, week)}:events`, 0, -1],
  ]);
  const rows = (res?.[0] as string[] | undefined) ?? [];
  if (!rows.length) return null;
  // Big moments per matchup: retracted scores dropped, the biggest kept
  const events = new Map<number, PlayEvent[]>();
  for (const r of (res?.[1] as string[] | undefined) ?? []) {
    const { matchupId, event } = JSON.parse(r) as { matchupId: number; event: PlayEvent };
    // Cleaned again on the way out, so text saved before a cleanup rule existed reads the same
    // and only the players the play names (saves from before that rule carry the whole window)
    if (event.desc) event.desc = cleanPlay(event.desc);
    events.set(matchupId, [...(events.get(matchupId) ?? []), playersInPlay(event)]);
  }
  const snapshots = rows.map((r) => JSON.parse(r) as Snapshot).sort((x, y) => x.t - y.t);
  const matchups = new Map<number, WinHistory['matchups'][number]>();
  snapshots.forEach((s, i) => {
    for (const [matchupId, a, b, odds, sa, sb] of s.m) {
      const m = matchups.get(matchupId) ?? { matchupId, a, b, odds: [], scores: [] };
      // A matchup missing from earlier snapshots starts where it first appears
      while (m.odds.length < i) {
        m.odds.push(odds);
        m.scores.push([sa, sb]);
      }
      m.odds.push(odds);
      m.scores.push([sa, sb]);
      matchups.set(matchupId, m);
    }
  });
  // Only moments with their play: one without (a score taken back, or saved before plays were
  // matched one by one) says nothing about what happened
  for (const m of matchups.values()) m.events = biggestPlays(dropRetractions(events.get(m.matchupId) ?? []).filter((e) => e.desc), BIG_PLAYS_KEPT);
  return { season, week, times: snapshots.map((s) => s.t), matchups: [...matchups.values()] };
}

/**
 * Replace the week's saved snapshots up to the end of a replay with the replay's own points
 * (scripts/build-win-history.ts --current): the week in progress, rebuilt from the play-by-play
 * for the games played so far. Snapshots saved live after the replay's last point are kept, and
 * their big moments unless one counts a starter whose game the replay finished (finished: IDs
 * and names), whose points it already has.
 */
export async function replaceSnapshots(history: WinHistory, finished: string[] = []): Promise<boolean> {
  const k = key(history.season, history.week);
  const end = history.times[history.times.length - 1] ?? 0;
  // A whole week in one write: more time than a live save gets
  const res = await redis([
    ['LRANGE', k, 0, -1],
    ['LRANGE', `${k}:events`, 0, -1],
  ], 20_000);
  // Without the saved points, replacing them could drop the live ones after the replay's end
  if (!res) return false;
  const later = ((res?.[0] as string[] | undefined) ?? []).filter((r) => (JSON.parse(r) as Snapshot).t > end);
  // The first live save after the replay measured its moments from a save the replay replaces,
  // so they repeat the replay's plays: kept only from the save after it on
  const firstLater = Math.min(...later.map((r) => (JSON.parse(r) as Snapshot).t));
  const done = new Set(finished);
  const laterEvents = ((res?.[1] as string[] | undefined) ?? []).filter((r) => {
    const { event } = JSON.parse(r) as { event: PlayEvent };
    return event.t > firstLater && !event.players.some((p) => done.has(p.id ?? '') || done.has(p.name));
  });
  const replayed = history.times.map((t, i) =>
    JSON.stringify({ t, m: history.matchups.map((m) => [m.matchupId, m.a, m.b, m.odds[i], m.scores[i][0], m.scores[i][1]]) } satisfies Snapshot)
  );
  // The replay's plays, which have descriptions, in place of the live events they cover
  const replayedEvents = history.matchups.flatMap((m) => (m.events ?? []).map((event) => JSON.stringify({ matchupId: m.matchupId, event })));
  const events = [...replayedEvents, ...laterEvents];
  return !!(await redis([
    ['DEL', k, `${k}:events`],
    ['RPUSH', k, ...replayed, ...later],
    ['EXPIRE', k, KEEP_SECONDS],
    ...(events.length ? [['RPUSH', `${k}:events`, ...events], ['EXPIRE', `${k}:events`, KEEP_SECONDS]] : []),
  ], 20_000));
}
