import { TeamStats } from '../types';

/**
 * Calculates cumulative win totals for each team over the season
 *
 * @param teams - Array of team statistics
 * @returns Object mapping usernames to arrays of cumulative wins by week
 */
export function calculateCumulativeWins(teams: TeamStats[]): Record<string, number[]> {
  const cumulativeWins: Record<string, number[]> = {};

  teams.forEach((team) => {
    cumulativeWins[team.username] = [];
    let totalWins = 0;

    team.weeklyResults.forEach((result) => {
      if (result === 'W') totalWins++;
      cumulativeWins[team.username].push(totalWins);
    });
  });

  return cumulativeWins;
}

/**
 * Calculates cumulative point totals for each team over the season
 *
 * @param teams - Array of team statistics
 * @returns Object mapping usernames to arrays of cumulative scores by week
 */
export function calculateCumulativeScores(teams: TeamStats[], maxWeek?: number): Record<string, number[]> {
  const cumulativeScores: Record<string, number[]> = {};
  const totalWeeks = teams[0]?.weeklyScores.length || 0;
  const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, totalWeeks) : totalWeeks;

  teams.forEach((team) => {
    cumulativeScores[team.username] = [];
    let totalScore = 0;

    team.weeklyScores.slice(0, numWeeks).forEach((score) => {
      totalScore += score;
      cumulativeScores[team.username].push(totalScore);
    });
  });

  return cumulativeScores;
}

/**
 * Calculates historical standings position for each week
 *
 * Determines each team's standing (1st, 2nd, etc.) for every week of the season
 * based on wins and total points at that point in time.
 *
 * @param teams - Array of team statistics
 * @param maxWeek - Optional maximum week to consider (only count completed weeks)
 * @returns Object mapping usernames to arrays of standings by week
 */
export function calculateStandingsOverTime(teams: TeamStats[], maxWeek?: number): Record<string, number[]> {
  const standingsOverTime: Record<string, number[]> = {};
  const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, teams[0]?.weeklyScores.length || 0) : teams[0]?.weeklyScores.length || 0;

  // Initialize
  teams.forEach((team) => {
    standingsOverTime[team.username] = [];
  });

  // For each week, calculate standings
  for (let week = 0; week < numWeeks; week++) {
    // Calculate standing value for each team at this week
    const weekStandings: Array<{ username: string; value: number }> = [];

    teams.forEach((team) => {
      let wins = 0;
      let points = 0;

      for (let w = 0; w <= week; w++) {
        // Ties count as half a win, as everywhere else
        if (team.weeklyResults[w] === 'W') wins++;
        else if (team.weeklyResults[w] === 'T') wins += 0.5;
        points += team.weeklyScores[w] || 0;
      }

      weekStandings.push({ username: team.username, value: wins + points * 0.000001 });
    });

    // Sort by standing value
    weekStandings.sort((a, b) => b.value - a.value);

    // Assign standings
    weekStandings.forEach((standing, index) => {
      standingsOverTime[standing.username].push(index + 1);
    });
  }

  return standingsOverTime;
}

/**
 * Calculates weekly performance rankings based on points scored
 *
 * Ranks teams 1-N for each week based solely on points scored that week
 * (not cumulative standings).
 *
 * @param teams - Array of team statistics
 * @param maxWeek - Optional maximum week to consider (only count completed weeks)
 * @returns Object mapping usernames to arrays of weekly rankings
 */
export function calculateWeeklyRankings(teams: TeamStats[], maxWeek?: number): Record<string, number[]> {
  const weeklyRankings: Record<string, number[]> = {};
  const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, teams[0]?.weeklyScores.length || 0) : teams[0]?.weeklyScores.length || 0;

  // Initialize
  teams.forEach((team) => {
    weeklyRankings[team.username] = [];
  });

  // For each week, rank teams by their score
  for (let week = 0; week < numWeeks; week++) {
    const weekScores: Array<{ username: string; score: number }> = [];

    teams.forEach((team) => {
      weekScores.push({
        username: team.username,
        score: team.weeklyScores[week] || 0,
      });
    });

    // Sort by score (highest first)
    weekScores.sort((a, b) => b.score - a.score);

    // Assign rankings
    weekScores.forEach((item, index) => {
      weeklyRankings[item.username].push(index + 1);
    });
  }

  return weeklyRankings;
}
