/**
 * Luck: a team's real wins against the wins its scoring deserved (the play-all expectation),
 * and its record in close games.
 */

import type { PlayEveryoneStats, TeamStats, WeekMatchup } from '../types';

/** Games decided by less than this many points count as close */
export const CLOSE_GAME_MARGIN = 10;

export interface LuckBreakdown {
  rosterId: number;
  teamName: string;
  username: string;
  wins: number;
  losses: number;
  ties: number;
  /** Its record had it played every other team every week */
  playAll: { wins: number; losses: number; ties: number };
  /** Play-all expected wins: the play-all win rate times games played */
  expectedWins: number;
  /** Luck: real wins (ties as half) minus expected wins */
  total: number;
  close: { wins: number; losses: number; ties: number };
}

export function luckBreakdown(
  teams: TeamStats[],
  playEveryone: PlayEveryoneStats[],
  matchups: Record<number, WeekMatchup[]>,
  maxWeek: number
): LuckBreakdown[] {
  const numWeeks = Math.min(maxWeek, teams[0]?.weeklyScores.length ?? 0);
  const byUser = new Map(playEveryone.map((p) => [p.username, p]));

  return teams.map((t) => {
    const close = { wins: 0, losses: 0, ties: 0 };
    for (let w = 1; w <= numWeeks; w++) {
      const m = matchups[w]?.find((x) => x.team1.rosterId === t.rosterId || x.team2.rosterId === t.rosterId);
      if (!m) continue;
      const [me, opp] = m.team1.rosterId === t.rosterId ? [m.team1, m.team2] : [m.team2, m.team1];
      const margin = me.points - opp.points;
      if (Math.abs(margin) < CLOSE_GAME_MARGIN) {
        if (margin > 0) close.wins++;
        else if (margin < 0) close.losses++;
        else close.ties++;
      }
    }
    const pe = byUser.get(t.username);
    const xw = pe?.expectedWins ?? 0;
    const real = t.wins + t.ties / 2;
    return {
      rosterId: t.rosterId,
      teamName: t.teamName,
      username: t.username,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      playAll: { wins: pe?.playAllWins ?? 0, losses: pe?.playAllLosses ?? 0, ties: pe?.playAllTies ?? 0 },
      expectedWins: xw,
      total: real - xw,
      close,
    };
  });
}
