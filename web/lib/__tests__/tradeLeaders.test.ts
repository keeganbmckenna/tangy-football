import { describe, it, expect } from 'vitest';
import { netHindsight, tradeLeaders, type SeasonTrade } from '../analyze/tradeLeaders';
import type { TradeHistorySide } from '../analyze/trade';

const side = (rosterId: number, before: number, after: number, points: number): TradeHistorySide => ({
  rosterId, receives: [], sends: [], picks: [], faab: 0,
  atTime: { before: { playoffs: before, champion: 0.1, lastPlace: 0.1 }, after: { playoffs: after, champion: 0.12, lastPlace: 0.1 }, lineupPerWeek: 1 },
  hindsight: { points, starts: 3 }, finalSeed: null,
});
const trades: SeasonTrade[] = [
  { season: '2024', trade: { id: 'a', week: 3, effectiveWeek: 3, sides: [side(1, 0.4, 0.5, 80), side(2, 0.6, 0.55, 40)] } },
  { season: '2025', trade: { id: 'b', week: 5, effectiveWeek: 5, sides: [side(1, 0.3, 0.2, 10), side(3, 0.5, 0.7, 120)] } },
  { season: '2025', trade: { id: 'c', week: 6, effectiveWeek: 6, sides: [side(3, 0.7, 0.72, 5), side(1, 0.2, 0.25, 30)] } },
];
// Roster 1 belongs to u1 both seasons; roster 2 is u2 in 2024; roster 3 is u3 in 2025
const userOf = (season: string, rosterId: number) => (rosterId === 1 ? 'u1' : rosterId === 2 && season === '2024' ? 'u2' : rosterId === 3 && season === '2025' ? 'u3' : null);

describe('tradeLeaders', () => {
  it('counts trades, partners, odds gained at the time and points received per manager', () => {
    const { leaders } = tradeLeaders(trades, userOf);
    const u1 = leaders.find((l) => l.userId === 'u1')!;
    expect(u1.trades).toBe(3);
    expect(u1.topPartner).toEqual({ userId: 'u3', trades: 2 });
    expect(u1.playoffOddsGained).toBeCloseTo(0.1 - 0.1 + 0.05);
    expect(u1.titleOddsGained).toBeCloseTo(0.06);
    expect(u1.starterPoints).toBe(120);
    expect(leaders[0].userId).toBe('u1');
  });

  it('ranks the biggest swings at the time and the best hauls', () => {
    const r = tradeLeaders(trades, userOf);
    expect(r.bestAtTheTime[0]).toMatchObject({ userId: 'u3', season: '2025' });
    expect(r.playoffDelta(r.bestAtTheTime[0])).toBeCloseTo(0.2);
    expect(r.worstAtTheTime[0].userId).toBe('u1');
    // Net of what was sent: u3 got 120 for 10 in trade b
    expect(r.bestHauls[0]).toMatchObject({ userId: 'u3' });
    expect(netHindsight(r.bestHauls[0].trade, r.bestHauls[0].side)).toBe(110);
  });

  it('nets each sent player\'s points for whoever got him, in a three-team trade', () => {
    const s = (rosterId: number, receives: string[], sends: string[], byPlayer: Record<string, number>): TradeHistorySide => ({
      rosterId, receives, sends, picks: [], faab: 0, atTime: null, finalSeed: null,
      hindsight: { points: Object.values(byPlayer).reduce((a, b) => a + b, 0), starts: 1, byPlayer },
    });
    // 1 sends A to 2 and B to 3, and gets C from 3; 2 sends nothing back but D to 3
    const trade = { id: 't', week: 4, effectiveWeek: 4, sides: [s(1, ['C'], ['A', 'B'], { C: 30 }), s(2, ['A'], ['D'], { A: 50 }), s(3, ['B', 'D'], ['C'], { B: 20, D: 15 })] };
    expect(netHindsight(trade, trade.sides[0])).toBe(30 - 50 - 20);
    expect(netHindsight(trade, trade.sides[2])).toBe(35 - 30);
  });
});
