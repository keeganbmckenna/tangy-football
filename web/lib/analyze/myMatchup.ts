import type { WeekMatchup } from '@/lib/types';
import type { LiveMatchupOdds } from '@/lib/analyze/live';

/**
 * With a team picked in the top menu, its matchup goes first, with it on the left; the
 * rest keep their order.
 */
export function myMatchupFirst<T>(games: T[], isMine: (g: T) => 'left' | 'right' | null, swap: (g: T) => T): T[] {
  const i = games.findIndex((g) => isMine(g) !== null);
  if (i < 0) return games;
  const mine = isMine(games[i]) === 'right' ? swap(games[i]) : games[i];
  return [mine, ...games.slice(0, i), ...games.slice(i + 1)];
}

const side = (a: number, b: number, me: number | null) => (me === null ? null : a === me ? 'left' : b === me ? 'right' : null);

/** Overview's weekly results, my matchup first */
export function myWeekMatchupFirst(games: WeekMatchup[], me: number | null): WeekMatchup[] {
  return myMatchupFirst(
    games,
    (m) => side(m.team1.rosterId, m.team2.rosterId, me),
    (m) => ({ ...m, team1: m.team2, team2: m.team1, winner: m.winner === 'team1' ? 'team2' : m.winner === 'team2' ? 'team1' : m.winner }),
  );
}

/** Live matchups, my matchup first */
export function myLiveMatchupFirst(games: LiveMatchupOdds[], me: number | null): LiveMatchupOdds[] {
  return myMatchupFirst(
    games,
    (m) => side(m.a.rosterId, m.b.rosterId, me),
    (m) => ({ ...m, a: m.b, b: m.a, aWinOdds: 1 - m.aWinOdds }),
  );
}
