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
    if (cmd === 'RPUSH') return { result: store.lists.set(k, [...(store.lists.get(k) ?? []), ...args.map(String)]).get(k)!.length };
    if (cmd === 'GET') return { result: store.strings.get(k) ?? null };
    if (cmd === 'DEL') return { result: [k, ...args.map(String)].filter((x) => store.lists.delete(x) || store.strings.delete(x)).length };
    if (cmd === 'EXPIRE') return { result: 1 };
    if (cmd === 'LRANGE') return { result: store.lists.get(k) ?? [] };
    return { error: 'unknown command' };
  });
  return { ok: true, json: async () => results };
});

const odds = (p: number, sa: number, sb: number): LiveMatchupOdds[] => [
  { matchupId: 1, aWinOdds: p, sd: 20, a: { rosterId: 3, score: sa, projected: 0, toPlay: 0, playing: 0 }, b: { rosterId: 5, score: sb, projected: 0, toPlay: 0, playing: 0 } },
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
    expect(await saveSnapshot('2026', 7, { odds: odds(0.6, 10, 8) })).toBe(true);
    // Within the interval: skipped
    expect(await saveSnapshot('2026', 7, { odds: odds(0.7, 20, 8) })).toBe(false);
    const history = await readSnapshots('2026', 7);
    expect(history?.times).toHaveLength(1);
    expect(history?.matchups[0]).toMatchObject({ matchupId: 1, a: 3, b: 5, odds: [0.6], scores: [[10, 8]] });
    expect(await readSnapshots('2026', 8)).toBeNull();
  });

  // One starter q (TEN) against r; a's odds rise 3 points per point q has over 10
  const starters = [{ matchupId: 1, a: ['q'], b: ['r'] }];
  const live = (q: number, plays: Array<{ t: number; text: string; scoring: boolean }>) => ({
    pts: { q, r: 8 },
    starters,
    nameOf: (id: string) => (id === 'q' ? 'M. Lemon' : id),
    teamOf: () => 'TEN',
    plays: async () => ({ TEN: { plays, teams: ['TEN', 'CIN'] } }),
    oddsWithout: (points: Record<string, number>) => ({ 1: Math.round((0.5 + (q - (points.q ?? 0) - 10) * 0.03) * 1000) / 1000 }),
  });

  it('saves each big moment with its play, and its own odds swing', async () => {
    const { saveSnapshot, readSnapshots } = await import('../liveHistory');
    const now = Math.round(Date.now() / 1000);
    const td = { t: now - 20, text: '(Shotgun) T.McKee pass short right to M.Lemon for 4 yards, TOUCHDOWN.', scoring: true };
    await saveSnapshot('2026', 8, { odds: odds(0.5, 10, 8), live: live(10, []) });
    store.strings.delete('win:2026:8:lock');
    await saveSnapshot('2026', 8, { odds: odds(0.71, 17, 8), live: live(17, [td]) });
    const history = await readSnapshots('2026', 8);
    expect(history?.times).toHaveLength(2);
    expect(history?.matchups[0].events).toEqual([
      expect.objectContaining({ t: td.t, desc: 'T.McKee pass short right to M.Lemon for 4 yards, TOUCHDOWN.', before: 0.5, after: 0.71, players: [{ side: 'a', name: 'M. Lemon', pts: 7, id: 'q' }] }),
    ]);
  });

  it('never shows a moment without its play, and works out the odds only with the save', async () => {
    const { saveSnapshot, readSnapshots } = await import('../liveHistory');
    await saveSnapshot('2026', 9, { odds: odds(0.5, 10, 8), live: live(10, []) });
    store.strings.delete('win:2026:9:lock');
    await saveSnapshot('2026', 9, { odds: odds(0.71, 17, 8), live: live(17, []) });
    expect((await readSnapshots('2026', 9))?.matchups[0].events).toEqual([]);
    // Within the interval, the odds aren't worked out at all
    const build = vi.fn(async () => ({ odds: odds(0.9, 30, 8) }));
    expect(await saveSnapshot('2026', 9, build)).toBe(false);
    expect(build).not.toHaveBeenCalled();
  });

  it('does nothing without Redis', async () => {
    vi.stubEnv('KV_REST_API_URL', '');
    const { saveSnapshot, readSnapshots } = await import('../liveHistory');
    expect(await saveSnapshot('2026', 7, { odds: odds(0.6, 10, 8) })).toBe(false);
    expect(await readSnapshots('2026', 7)).toBeNull();
    expect(fakeRedis).not.toHaveBeenCalled();
  });
});
