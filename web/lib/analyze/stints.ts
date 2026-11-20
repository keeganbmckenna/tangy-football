/**
 * How long a player stayed on the team that acquired him, so what he scored there is credited to
 * that move only: a pickup, a claim or a trade counts his starts until he's dropped or traded
 * away, and never past the week before the same team acquires him again (that's a move of its own).
 */

import type { SleeperTransaction } from '../types';

// Processing order: Sleeper's status_updated (when a claim or trade went through), then created
const order = (t: SleeperTransaction) => [t.leg, t.status_updated || t.created || 0];
const after = (a: SleeperTransaction, b: SleeperTransaction) => {
  const [la, ta] = order(a);
  const [lb, tb] = order(b);
  return la > lb || (la === lb && ta > tb);
};

/**
 * The last week to credit a player's starts to the transaction that brought him to rosterId: the
 * week he next left (dropped or traded away; that week counts, since he only starts if still
 * there) or the week before the team next acquired him, whichever is first. Infinity if neither.
 */
export function stintEnd(transactions: SleeperTransaction[], acquired: SleeperTransaction, playerId: string, rosterId: number): number {
  let end = Infinity;
  for (const t of transactions) {
    if (t.status !== 'complete' || t === acquired || t.transaction_id === acquired.transaction_id || !after(t, acquired)) continue;
    if (t.drops?.[playerId] === rosterId) end = Math.min(end, t.leg);
    if (t.adds?.[playerId] === rosterId) end = Math.min(end, t.leg - 1);
  }
  return end;
}
