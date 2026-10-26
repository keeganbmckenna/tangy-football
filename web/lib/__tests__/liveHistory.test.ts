import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiveMatchupOdds } from '../analyze/live';

// A tiny Redis behind Upstash's REST pipeline: SET NX EX, RPUSH, EXPIRE, LRANGE
const store = { strings: new Map<string, string>(), lists: new Map<string, string[]>() };
const fakeRedis = vi.fn(async (_url: string, init: { body: string }) => {
  const results = (JSON.parse(init.body) as Array<Array<string | number>>).map(([cmd, key, ...args]) => {
    const k = String(key);
    if (cmd === 'SET') {
      if (args.includes('NX') && store.strings.has(k)) return { result: null };
      store.strings.set(k, String(args[0]));
      return { result: 'OK' };
    }
    if (cmd === 'RPUSH') return { result: store.lists.set(k, [...(store.lists.get(k) ?? []), String(args[0])]).get(k)!.length };
    if (cmd === 'EXPIRE') return { result: 1 };
    if (cmd === 'LRANGE') return { result: store.lists.get(k) ?? [] };
    return { error: 'unknown command' };
  });
  return { ok: true, json: async () => results };
});

const odds = (p: number, sa: number, sb: number): LiveMatchupOdds[] => [
  { matchupId: 1, aWinOdds: p, a: { rosterId: 3, score: sa, projected: 0, toPlay: 0, playing: 0 }, b: { rosterId: 5, score: sb, projected: 0, toPlay: 0, playing: 0 } },
];

describe('live win history', () => {
  beforeEach(() => {
    vi.resetModules();
    store.strings.clear();
    store.lists.clear();
    fakeRedis.mockClear();
    vi.stubGlobal('fetch', fakeRedis);
    vi.stubEnv('KV_REST_API_URL', 'https://redis.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'token');
  });

  it('saves at most one snapshot per interval and reads them back as a win history', async () => {
    const { saveSnapshot, readSnapshots } = await import('../liveHistory');
    expect(await saveSnapshot('2026', 7, odds(0.6, 10, 8))).toBe(true);
    // Within the interval: skipped
    expect(await saveSnapshot('2026', 7, odds(0.7, 20, 8))).toBe(false);
    const history = await readSnapshots('2026', 7);
    expect(history?.times).toHaveLength(1);
    expect(history?.matchups[0]).toMatchObject({ matchupId: 1, a: 3, b: 5, odds: [0.6], scores: [[10, 8]] });
    expect(await readSnapshots('2026', 8)).toBeNull();
  });

  it('does nothing without Redis', async () => {
    vi.stubEnv('KV_REST_API_URL', '');
    const { saveSnapshot, readSnapshots } = await import('../liveHistory');
    expect(await saveSnapshot('2026', 7, odds(0.6, 10, 8))).toBe(false);
    expect(await readSnapshots('2026', 7)).toBeNull();
    expect(fakeRedis).not.toHaveBeenCalled();
  });
});
