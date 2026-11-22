import { describe, expect, it } from 'vitest';
import { bestLineup, SLOT_POSITIONS } from '@/lib/analyze/playoffOdds';

/** Every assignment of players to slots, the best total (small cases only) */
function bruteForce(players: Record<string, { position: string; points: number }>, slots: string[]): number {
  const ids = Object.keys(players);
  const starting = slots.filter((s) => !['BN', 'IR', 'TAXI'].includes(s));
  let best = 0;
  const go = (k: number, used: Set<string>, total: number) => {
    if (k === starting.length) {
      best = Math.max(best, total);
      return;
    }
    const eligible = SLOT_POSITIONS[starting[k]] ?? [starting[k]];
    go(k + 1, used, total);
    for (const id of ids) {
      if (used.has(id) || !eligible.includes(players[id].position)) continue;
      used.add(id);
      go(k + 1, used, total + players[id].points);
      used.delete(id);
    }
  };
  go(0, new Set(), 0);
  return best;
}

const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

describe('bestLineup', () => {
  it('finds the best lineup when flex slots overlap (WRRB_FLEX with REC_FLEX)', () => {
    // Greedy fills WRRB_FLEX with the WR (best of RB/WR), leaving REC_FLEX the weak TE; best is RB there, WR in REC_FLEX
    const players = { wr: { position: 'WR', points: 15 }, rb: { position: 'RB', points: 12 }, te: { position: 'TE', points: 3 } };
    const r = bestLineup(Object.keys(players), players, ['WRRB_FLEX', 'REC_FLEX', 'BN']);
    expect(r.total).toBe(27);
    expect(Object.fromEntries(r.starters.map((s) => [s.slot, s.playerId]))).toEqual({ WRRB_FLEX: 'rb', REC_FLEX: 'wr' });
  });

  it('matches a brute-force search on random rosters', () => {
    const next = rng(7);
    const layouts = [
      ['QB', 'RB', 'WR', 'TE', 'WRRB_FLEX', 'REC_FLEX', 'BN', 'BN'],
      ['RB', 'WR', 'WRRB_FLEX', 'REC_FLEX', 'FLEX', 'BN'],
      ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'BN'],
      ['WR', 'REC_FLEX', 'WRRB_FLEX', 'SUPER_FLEX', 'BN'],
    ];
    const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K'];
    for (let c = 0; c < 120; c++) {
      const layout = layouts[c % layouts.length];
      const players: Record<string, { position: string; points: number }> = {};
      const n = 5 + Math.floor(next() * 4);
      for (let i = 0; i < n; i++) players[`p${i}`] = { position: positions[Math.floor(next() * positions.length)], points: Math.round(next() * 250) / 10 };
      const r = bestLineup(Object.keys(players), players, layout);
      expect(r.total).toBeCloseTo(bruteForce(players, layout), 9);
      // A real lineup: each player once, each in a slot that takes his position
      const ids = r.starters.map((s) => s.playerId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of r.starters) expect(SLOT_POSITIONS[s.slot] ?? [s.slot]).toContain(players[s.playerId].position);
    }
  });
});
