/**
 * Why a team's record is what it is: its real wins split from the wins its scoring
 * deserved (the play-all expectation) into two kinds of luck, plus its close-game record.
 *
 * - Who you played (schedule): the wins it would have had if every opponent had scored its own
 *   season average, minus the play-all expectation. Drawing weak opponents (or strong ones)
 *   shows up here.
 * - How they played (opponentsDays): real wins minus those average-opponent wins. Opponents
 *   having off weeks against you (or big weeks) show up here.
 *
 * The two add up to the play-all luck factor (real wins minus expected wins).
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
  /** Wins had every opponent scored its season average */
  averageOpponentWins: number;
  schedule: number;
  opponentsDays: number;
  /** schedule + opponentsDays = real wins (ties as half) minus expected wins */
  total: number;
  close: { wins: number; losses: number; ties: number };
  /** Points opponents scored against this team above their own season averages, per game */
  opponentsAboveAverage: number;
}

export function luckBreakdown(
  teams: TeamStats[],
  playEveryone: PlayEveryoneStats[],
  matchups: Record<number, WeekMatchup[]>,
  maxWeek: number
): LuckBreakdown[] {
  const numWeeks = Math.min(maxWeek, teams[0]?.weeklyScores.length ?? 0);
  const average = new Map(
    teams.map((t) => {
      const scores = t.weeklyScores.slice(0, numWeeks);
      return [t.rosterId, scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0];
    })
  );
  const byUser = new Map(playEveryone.map((p) => [p.username, p]));

  return teams.map((t) => {
    let averageOpponentWins = 0;
    let above = 0;
    let games = 0;
    const close = { wins: 0, losses: 0, ties: 0 };
    for (let w = 1; w <= numWeeks; w++) {
      const m = matchups[w]?.find((x) => x.team1.rosterId === t.rosterId || x.team2.rosterId === t.rosterId);
      if (!m) continue;
      const [me, opp] = m.team1.rosterId === t.rosterId ? [m.team1, m.team2] : [m.team2, m.team1];
      const oppAverage = average.get(opp.rosterId) ?? opp.points;
      averageOpponentWins += me.points > oppAverage ? 1 : me.points === oppAverage ? 0.5 : 0;
      above += opp.points - oppAverage;
      games++;
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
      averageOpponentWins,
      schedule: averageOpponentWins - xw,
      opponentsDays: real - averageOpponentWins,
      total: real - xw,
      close,
      opponentsAboveAverage: games ? above / games : 0,
    };
  });
}
