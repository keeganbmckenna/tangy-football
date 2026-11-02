/**
 * Pings that keep the week-in-progress win-probability chart saving whether or not anyone has the
 * site open. Once a day an Upstash QStash schedule calls /api/live/plan, which reads the next day's
 * kickoffs from ESPN and queues a delayed QStash message to /api/live every few minutes while games
 * can be on, and none otherwise: each delivery counts against QStash's daily message allowance.
 *
 * Needs QSTASH_TOKEN, QSTASH_URL and the two signing keys, set by Vercel's QStash integration.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** How often to ping while a game can be on */
export const PING_SECONDS = 180;
/** How long after kickoff a game can still be on (overtime and a long delay included) */
export const GAME_SECONDS = 4.5 * 3600;

/**
 * Ping times (Unix seconds) in [from, to): every PING_SECONDS on a fixed grid, so a re-plan queues
 * the same times, while any game is between its kickoff and GAME_SECONDS after it
 */
export function pingTimes(kickoffs: number[], from: number, to: number): number[] {
  const times: number[] = [];
  for (let t = Math.ceil(from / PING_SECONDS) * PING_SECONDS; t < to; t += PING_SECONDS) {
    if (kickoffs.some((k) => t >= k && t <= k + GAME_SECONDS)) times.push(t);
  }
  return times;
}

/** ESPN's dates are US Eastern days */
const easternDay = (t: number) =>
  new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replaceAll('-', '');

/** NFL kickoffs (Unix seconds) on the Eastern days from yesterday through tomorrow */
export async function kickoffsAround(now: number): Promise<number[]> {
  const days = [...new Set([now - 86400, now, now + 86400].map(easternDay))];
  const lists = await Promise.all(
    days.map(async (day) => {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${day}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`ESPN scoreboard failed (${res.status})`);
      const { events = [] } = (await res.json()) as { events?: Array<{ date: string }> };
      return events.map((e) => Date.parse(e.date) / 1000).filter(Number.isFinite);
    })
  );
  return [...new Set(lists.flat())];
}

/** Queue a GET of `url` at each time, at most once per time (QStash deduplicates by id) */
export async function queuePings(url: string, times: number[]): Promise<void> {
  const token = process.env.QSTASH_TOKEN;
  const base = process.env.QSTASH_URL ?? 'https://qstash.upstash.io';
  if (!token) throw new Error('QSTASH_TOKEN is not set');
  for (let i = 0; i < times.length; i += 100) {
    const batch = times.slice(i, i + 100).map((t) => ({
      destination: url,
      headers: {
        'Upstash-Method': 'GET',
        'Upstash-Not-Before': String(t),
        'Upstash-Retries': '0',
        'Upstash-Deduplication-Id': `live-ping-${t}`,
      },
    }));
    const res = await fetch(`${base}/v2/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`QStash batch failed (${res.status}): ${await res.text()}`);
  }
}

const base64url = (b: Buffer) => b.toString('base64url');

/**
 * Whether a request came from QStash: its Upstash-Signature is a JWT signed (HS256) with the
 * current or next signing key, for this URL, unexpired, carrying the body's SHA-256
 */
export function verifyQstash(signature: string | null, url: string, body: string, now = Date.now() / 1000): boolean {
  const keys = [process.env.QSTASH_CURRENT_SIGNING_KEY, process.env.QSTASH_NEXT_SIGNING_KEY].filter((k): k is string => !!k);
  const parts = signature?.split('.') ?? [];
  if (!keys.length || parts.length !== 3) return false;
  const [header, payload, sig] = parts;
  const signed = keys.some((key) => {
    const expected = Buffer.from(base64url(createHmac('sha256', key).update(`${header}.${payload}`).digest()));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!signed) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { iss?: string; sub?: string; exp?: number; nbf?: number; body?: string };
    const bodyHash = base64url(createHash('sha256').update(body).digest());
    return (
      claims.iss === 'Upstash' &&
      claims.sub === url &&
      (claims.exp ?? 0) > now &&
      (claims.nbf ?? 0) <= now + 60 &&
      (claims.body ?? '').replace(/=+$/, '') === bodyHash
    );
  } catch {
    return false;
  }
}
