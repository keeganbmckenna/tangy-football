import { LeagueData, SleeperMatchup, TeamStats } from '../types';
import { getAvatarUrl, getCustomTeamName, getTeamName } from './teamIdentity';

/**
 * Calculates comprehensive statistics for all teams in the league
 *
 * Processes roster data and matchup results to generate:
 * - Win/loss records
 * - Total and average points
 * - Points against
 * - Weekly scores and results
 * - League standings
 *
 * @param data - Complete league data from Sleeper API
 * @param lastScoredWeek - Optional last completed week for performance metrics
 * @returns Array of team statistics sorted by standings
 *
 * @example
 * ```ts
 * const teamStats = calculateTeamStats(leagueData);
 * // Returns teams sorted by standing with full statistics
 * ```
 */
export function calculateTeamStats(data: LeagueData, lastScoredWeek?: number): TeamStats[] {
  const stats: Record<number, TeamStats> = {};

  // Initialize stats from rosters
  data.rosters.forEach((roster) => {
    const { name, username } = getTeamName(roster.roster_id, data);
    const user = data.userMap[roster.owner_id];
    const customName = getCustomTeamName(user, name);

    const division = roster.settings.division;
    stats[roster.roster_id] = {
      rosterId: roster.roster_id,
      teamName: customName,
      username,
      wins: roster.settings.wins,
      losses: roster.settings.losses,
      ties: roster.settings.ties,
      totalPoints: roster.settings.fpts + (roster.settings.fpts_decimal || 0) / 100,
      pointsAgainst:
        (roster.settings.fpts_against || 0) +
        ((roster.settings.fpts_against_decimal || 0) / 100),
      avgPoints: 0,
      weeklyScores: [],
      weeklyResults: [],
      weeklyOpponentScores: [],
      standing: 0,
      standingValue: 0,
      division,
      divisionName: data.divisionNames?.[division || 0],
      avatarUrl: getAvatarUrl(user),
    };
  });

  // Calculate weekly scores and results
  Object.entries(data.matchups).forEach(([, matchups]) => {
    // Group matchups by matchup_id
    const matchupGroups: Record<number, SleeperMatchup[]> = {};
    matchups.forEach((matchup) => {
      if (!matchupGroups[matchup.matchup_id]) {
        matchupGroups[matchup.matchup_id] = [];
      }
      matchupGroups[matchup.matchup_id].push(matchup);
    });

    // Determine winners for each matchup
    Object.values(matchupGroups).forEach((teams) => {
      if (teams.length === 2) {
        const [team1, team2] = teams;
        const points1 = team1.points;
        const points2 = team2.points;

        // Add weekly scores
        stats[team1.roster_id].weeklyScores.push(points1);
        stats[team2.roster_id].weeklyScores.push(points2);

        // Track opponent scores for margin calculations
        stats[team1.roster_id].weeklyOpponentScores.push(points2);
        stats[team2.roster_id].weeklyOpponentScores.push(points1);

        // Determine result
        if (points1 > points2) {
          stats[team1.roster_id].weeklyResults.push('W');
          stats[team2.roster_id].weeklyResults.push('L');
        } else if (points2 > points1) {
          stats[team1.roster_id].weeklyResults.push('L');
          stats[team2.roster_id].weeklyResults.push('W');
        } else {
          stats[team1.roster_id].weeklyResults.push('T');
          stats[team2.roster_id].weeklyResults.push('T');
        }
      }
    });
  });

  // Calculate averages and standing values
  const teamStatsArray = Object.values(stats);
  teamStatsArray.forEach((team) => {
    // Average over completed (scored) weeks only: weeklyScores can include the
    // current unscored week, which would drag the average down.
    const weeksToAnalyze = lastScoredWeek !== undefined
      ? Math.min(lastScoredWeek, team.weeklyScores.length)
      : team.weeklyScores.length;
    if (weeksToAnalyze > 0) {
      team.avgPoints = team.totalPoints / weeksToAnalyze;
    }

    // Calculate performance breakdown metrics (only for completed weeks)
    const winScores: number[] = [];
    const lossScores: number[] = [];
    const winMargins: number[] = [];
    const lossMargins: number[] = [];

    const opponentScores = team.weeklyOpponentScores;

    // Only loop through completed weeks
    for (let index = 0; index < weeksToAnalyze; index++) {
      const result = team.weeklyResults[index];
      const score = team.weeklyScores[index];
      const opponentScore = opponentScores[index];

      if (result === 'W') {
        winScores.push(score);
        winMargins.push(score - opponentScore);
      } else if (result === 'L') {
        lossScores.push(score);
        lossMargins.push(score - opponentScore); // Will be negative
      }
    }

    // Calculate means and medians
    if (winScores.length > 0) {
      team.avgPointsInWins = winScores.reduce((a, b) => a + b, 0) / winScores.length;
      const sortedWinScores = [...winScores].sort((a, b) => a - b);
      team.medianPointsInWins = sortedWinScores[Math.floor(sortedWinScores.length / 2)];

      team.avgWinMargin = winMargins.reduce((a, b) => a + b, 0) / winMargins.length;
      const sortedWinMargins = [...winMargins].sort((a, b) => a - b);
      team.medianWinMargin = sortedWinMargins[Math.floor(sortedWinMargins.length / 2)];
    }

    if (lossScores.length > 0) {
      team.avgPointsInLosses = lossScores.reduce((a, b) => a + b, 0) / lossScores.length;
      const sortedLossScores = [...lossScores].sort((a, b) => a - b);
      team.medianPointsInLosses = sortedLossScores[Math.floor(sortedLossScores.length / 2)];

      team.avgLossMargin = lossMargins.reduce((a, b) => a + b, 0) / lossMargins.length;
      const sortedLossMargins = [...lossMargins].sort((a, b) => a - b);
      team.medianLossMargin = sortedLossMargins[Math.floor(sortedLossMargins.length / 2)];
    }
  });

  // Standing order: wins first, total points breaks ties.
  // The fractional part is always < 1, so a team can never outrank a team with more wins.
  const maxPoints = Math.max(...teamStatsArray.map((t) => t.totalPoints));
  teamStatsArray.forEach((team) => {
    team.standingValue = team.wins + team.totalPoints / (maxPoints + 1);
  });

  // Sort by standing value and assign standings
  teamStatsArray.sort((a, b) => b.standingValue - a.standingValue);
  teamStatsArray.forEach((team, index) => {
    team.standing = index + 1;
  });

  return teamStatsArray;
}
