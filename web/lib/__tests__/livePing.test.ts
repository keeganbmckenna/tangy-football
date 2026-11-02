import { createHash, createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME_SECONDS, PING_SECONDS, pingTimes, verifyQstash } from '../livePing';

describe('pingTimes', () => {
  const kickoff = 1_794_160_800; // 2026-11-08 18:00 UTC

  it('pings only from kickoff until a game can be over', () => {
    const times = pingTimes([kickoff], kickoff - 3600, kickoff + 86400);
    expect(times[0]).toBe(kickoff);
    expect(times.at(-1)).toBeLessThanOrEqual(kickoff + GAME_SECONDS);
    expect(times).toHaveLength(Math.floor(GAME_SECONDS / PING_SECONDS) + 1);
  });

  it('merges overlapping games and keeps a fixed grid', () => {
    const times = pingTimes([kickoff, kickoff + 3 * 3600 + 25 * 60], kickoff, kickoff + 86400);
    expect(new Set(times).size).toBe(times.length);
    expect(times.every((t) => t % PING_SECONDS === 0)).toBe(true);
    expect(times.at(-1)! - times[0]).toBeGreaterThan(GAME_SECONDS);
  });

  it('queues nothing without games', () => {
    expect(pingTimes([], 0, 86400)).toEqual([]);
  });
});

describe('verifyQstash', () => {
  const key = 'sig_current';
  const url = 'https://tangy-football.vercel.app/api/live/plan';
  const now = 1_794_000_000;
  const jwt = (claims: object, signingKey = key) => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(claims)}`;
    return `${head}.${createHmac('sha256', signingKey).update(head).digest('base64url')}`;
  };
  const claims = (body: string) => ({ iss: 'Upstash', sub: url, exp: now + 300, nbf: now, body: createHash('sha256').update(body).digest('base64url') });

  afterEach(() => vi.unstubAllEnvs());

  it('accepts a request QStash signed for this URL and body', () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', key);
    expect(verifyQstash(jwt(claims('')), url, '', now)).toBe(true);
  });

  it('accepts the next signing key too', () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', 'old');
    vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', key);
    expect(verifyQstash(jwt(claims('')), url, '', now)).toBe(true);
  });

  it('rejects anything else', () => {
    vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', key);
    expect(verifyQstash(null, url, '', now)).toBe(false);
    expect(verifyQstash(jwt(claims(''), 'wrong'), url, '', now)).toBe(false);
    expect(verifyQstash(jwt(claims('')), `${url}x`, '', now)).toBe(false);
    expect(verifyQstash(jwt(claims('')), url, 'changed', now)).toBe(false);
    expect(verifyQstash(jwt(claims('')), url, '', now + 600)).toBe(false);
  });

  it('rejects everything without signing keys', () => {
    expect(verifyQstash(jwt(claims('')), url, '', now)).toBe(false);
  });
});
