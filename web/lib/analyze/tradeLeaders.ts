/**
 * All-time trade stats from every season's graded trades: how often each
 * manager trades and with whom, what their trades did to their playoff and
 * title odds at the time, and what the players they got scored for them.
 */

import type { TradeHistoryEntry, TradeHistorySide } from './trade';

export interface SeasonTrade {
  season: string;
  trade: TradeHistoryEntry;
}

export interface TradeLeader {
  userId: string;
  trades: number;
  /** Most frequent trade partner and how many trades with them */
  topPartner: { userId: string; trades: number } | null;
  /** Sum of the playoff-odds change at the time across their trades */
  playoffOddsGained: number;
  titleOddsGained: number;
  /** Points the players they got scored in their starting lineup */
  starterPoints: number;
}

export interface TradeSideRef {
  season: string;
  trade: TradeHistoryEntry;
  side: TradeHistorySide;
  userId: string;
}

/**
 * A side's net in hindsight: what the players it received scored in its starting lineup, minus
 * what the players it sent scored in their new teams' lineups. Each received player's points
 * (byPlayer) make it exact; files built before those were kept fall back to the other sides'
 * totals, which is exact for a two-team trade.
 */
export function netHindsight(trade: TradeHistoryEntry, side: TradeHistorySide): number {
  const others = trade.sides.filter((o) => o.rosterId !== side.rosterId);
  const given = others.every((o) => o.hindsight.byPlayer)
    ? side.sends.reduce((sum, p) => sum + others.reduce((s, o) => s + (o.hindsight.byPlayer?.[p] ?? 0), 0), 0)
    : others.reduce((sum, o) => sum + o.hindsight.points, 0);
  return Math.round((side.hindsight.points - given) * 100) / 100;
}

export function tradeLeaders(trades: SeasonTrade[], userOf: (season: string, rosterId: number) => string | null) {
  const rows = new Map<string, TradeLeader & { partners: Map<string, number> }>();
  const sides: TradeSideRef[] = [];
  for (const { season, trade } of trades) {
    const users = trade.sides.map((s) => userOf(season, s.rosterId));
    trade.sides.forEach((side, i) => {
      const userId = users[i];
      if (!userId) return;
      sides.push({ season, trade, side, userId });
      let r = rows.get(userId);
      if (!r) {
        r = { userId, trades: 0, topPartner: null, playoffOddsGained: 0, titleOddsGained: 0, starterPoints: 0, partners: new Map() };
        rows.set(userId, r);
      }
      r.trades++;
      for (const other of users) {
        if (other && other !== userId) r.partners.set(other, (r.partners.get(other) ?? 0) + 1);
      }
      if (side.atTime) {
        r.playoffOddsGained += side.atTime.after.playoffs - side.atTime.before.playoffs;
        r.titleOddsGained += (side.atTime.after.champion ?? 0) - (side.atTime.before.champion ?? 0);
      }
      r.starterPoints += side.hindsight.points;
    });
  }
  const leaders: TradeLeader[] = [...rows.values()]
    .map(({ partners, ...r }) => {
      const top = [...partners.entries()].sort((a, b) => b[1] - a[1])[0];
      return { ...r, topPartner: top ? { userId: top[0], trades: top[1] } : null };
    })
    .sort((a, b) => b.trades - a.trades || b.playoffOddsGained - a.playoffOddsGained);

  const playoffDelta = (s: TradeSideRef) => (s.side.atTime ? s.side.atTime.after.playoffs - s.side.atTime.before.playoffs : 0);
  const graded = sides.filter((s) => s.side.atTime);
  return {
    leaders,
    /** Biggest playoff-odds gains and losses at the time of a trade */
    bestAtTheTime: [...graded].sort((a, b) => playoffDelta(b) - playoffDelta(a)).slice(0, 5),
    worstAtTheTime: [...graded].sort((a, b) => playoffDelta(a) - playoffDelta(b)).slice(0, 5),
    /** Best trades in hindsight: incoming players' starting-lineup points minus the outgoing players' for their new teams */
    bestHauls: [...sides].sort((a, b) => netHindsight(b.trade, b.side) - netHindsight(a.trade, a.side)).slice(0, 5),
    playoffDelta,
  };
}
