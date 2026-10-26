/**
 * How steady each team's scoring is: the spread of its weekly scores, its floor and ceiling,
 * and how often it boomed or busted against the league's own quartiles.
 */

import type { TeamStats } from '../types';

export interface Consistency {
  rosterId: number;
  teamName: string;
  username: string;
  scores: number[];
  mean: number;
  median: number;
  q1: number;
  q3: number;
  /** Standard deviation of its weekly scores */
  sd: number;
  floor: number;
  ceiling: number;
  /** Weeks above the league's 75th percentile of all scores */
  booms: number;
  /** Weeks below the league's 25th percentile */
  busts: number;
}

/** Linear-interpolated quantile of sorted values */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function consistency(teams: TeamStats[], maxWeek: number): { teams: Consistency[]; leagueQ1: number; leagueQ3: number } {
  const weeks = Math.min(maxWeek, teams[0]?.weeklyScores.length ?? 0);
  const all = teams.flatMap((t) => t.weeklyScores.slice(0, weeks)).sort((a, b) => a - b);
  const leagueQ1 = quantile(all, 0.25);
  const leagueQ3 = quantile(all, 0.75);
  return {
    leagueQ1,
    leagueQ3,
    teams: teams.map((t) => {
      const scores = t.weeklyScores.slice(0, weeks);
      const sorted = [...scores].sort((a, b) => a - b);
      const mean = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
      const variance = scores.length > 1 ? scores.reduce((s, v) => s + (v - mean) ** 2, 0) / (scores.length - 1) : 0;
      return {
        rosterId: t.rosterId,
        teamName: t.teamName,
        username: t.username,
        scores,
        mean,
        median: quantile(sorted, 0.5),
        q1: quantile(sorted, 0.25),
        q3: quantile(sorted, 0.75),
        sd: Math.sqrt(variance),
        floor: sorted[0] ?? 0,
        ceiling: sorted[sorted.length - 1] ?? 0,
        booms: scores.filter((v) => v > leagueQ3).length,
        busts: scores.filter((v) => v < leagueQ1).length,
      };
    }),
  };
}
