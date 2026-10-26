import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LiveMatchupOdds } from '../analyze/live';

// A tiny in-memory Redis standing in for the client: SET NX EX, RPUSH, EXPIRE, LRANGE
const store = { strings: new Map<string, string>(), lists: new Map<string, string[]>(), connects: 0 };
vi.mock('redis', () => ({
  createClient: () => {
    let open = false;
    return {
      on: () => undefined,
      get isOpen() {
        return open;
      },
      connect: async () => {
        store.connects++;
        open = true;
      },
      quit: async () => {
        open = false;
      },
      set: async (k: string, v: string, opts: { NX?: boolean }) => {
        if (opts?.NX && store.strings.has(k)) return null;
        store.strings.set(k, v);
        return 'OK';
      },
      rPush: async (k: string, v: string) => store.lists.set(k, [...(store.lists.get(k) ?? []), v]).get(k)!.length,
      expire: async () => true,
      lRange: async (k: string) => store.lists.get(k) ?? [],
    };
  },
}));

const odds = (p: number, sa: number, sb: number): LiveMatchupOdds[] => [
  { matchupId: 1, aWinOdds: p, a: { rosterId: 3, score: sa, projected: 0, toPlay: 0, playing: 0 }, b: { rosterId: 5, score: sb, projected: 0, toPlay: 0, playing: 0 } },
];

describe('live win history', () => {
  beforeEach(() => {
    vi.resetModules();
    store.strings.clear();
    store.lists.clear();
    store.connects = 0;
    vi.stubEnv('REDIS_URL', 'redis://test');
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
    vi.stubEnv('REDIS_URL', '');
    const { saveSnapshot, readSnapshots } = await import('../liveHistory');
    expect(await saveSnapshot('2026', 7, odds(0.6, 10, 8))).toBe(false);
    expect(await readSnapshots('2026', 7)).toBeNull();
    expect(store.connects).toBe(0);
  });
});
