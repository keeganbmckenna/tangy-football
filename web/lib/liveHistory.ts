/**
 * The win-probability history of the week in progress: each matchup's live win odds saved
 * every couple of minutes while games are on (by /api/live, which a workflow also pings during
 * game windows), in Redis. The "How it swung" chart reads it back until the week's play-by-play
 * replay (lib/winHistory.ts) replaces it.
 *
 * Needs REDIS_URL, set by Vercel's Redis integration (web/.env.local for local runs); without
 * it saving and reading do nothing.
 */

import { createClient } from 'redis';
import type { LiveMatchupOdds } from '@/lib/analyze/live';
import type { WinHistory } from '@/lib/winHistory';

/** At most one snapshot per this many seconds */
const EVERY_SECONDS = 120;
/** Kept this long: the play-by-play replay takes over within the week */
const KEEP_SECONDS = 45 * 24 * 3600;

const REDIS_URL = process.env.REDIS_URL;

export const liveHistoryEnabled = () => !!REDIS_URL;

/**
 * Run some work with a Redis connection, opened and closed around it (serverless functions
 * don't keep connections between requests reliably); null without Redis or on any failure
 */
async function withRedis<T>(work: (client: ReturnType<typeof createClient>) => Promise<T>): Promise<T | null> {
  if (!REDIS_URL) return null;
  const client = createClient({ url: REDIS_URL, socket: { connectTimeout: 3000, reconnectStrategy: false } });
  client.on('error', () => {});
  try {
    await client.connect();
    return await work(client);
  } catch {
    return null;
  } finally {
    if (client.isOpen) await client.quit().catch(() => {});
  }
}

const key = (season: string, week: number) => `win:${season}:${week}`;

/** One saved moment: time (Unix seconds) and [matchupId, a, b, a's odds, a's score, b's score] per matchup */
interface Snapshot {
  t: number;
  m: Array<[number, number, number, number, number, number]>;
}

/** Save the matchups' odds now, unless a snapshot was saved in the last EVERY_SECONDS */
export async function saveSnapshot(season: string, week: number, odds: LiveMatchupOdds[]): Promise<boolean> {
  if (!liveHistoryEnabled() || !odds.length) return false;
  const k = key(season, week);
  const snapshot: Snapshot = {
    t: Math.round(Date.now() / 1000),
    m: odds.map((o) => [o.matchupId, o.a.rosterId, o.b.rosterId, Math.round(o.aWinOdds * 1000) / 1000, Math.round(o.a.score * 10) / 10, Math.round(o.b.score * 10) / 10]),
  };
  const saved = await withRedis(async (client) => {
    // The lock decides who saves: SET NX with an expiry lets one request through per interval
    if ((await client.set(`${k}:lock`, '1', { NX: true, EX: EVERY_SECONDS - 5 })) !== 'OK') return false;
    await client.rPush(k, JSON.stringify(snapshot));
    await client.expire(k, KEEP_SECONDS);
    return true;
  });
  return saved === true;
}

/** The week's saved snapshots as a win history (null without Redis or snapshots) */
export async function readSnapshots(season: string, week: number): Promise<WinHistory | null> {
  const rows = (await withRedis((client) => client.lRange(key(season, week), 0, -1))) ?? [];
  if (!rows.length) return null;
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
  return { season, week, times: snapshots.map((s) => s.t), matchups: [...matchups.values()] };
}
