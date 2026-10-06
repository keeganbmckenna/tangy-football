import { TeamStats, PlayEveryoneStats, WeeklyPlayAllStats, WeeklyPlayAllRecord } from '../types';

/**
 * Formats a record as W-L, adding -T only when there are ties
 *
 * @example formatRecord(8, 3, 0) // "8-3"
 * @example formatRecord(5, 5, 1) // "5-5-1"
 */
export function formatRecord(wins: number, losses: number, ties = 0): string {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/**
 * Win percentage counting a tie as half a win. Returns 0 with no games.
 */
export function winPercentage(wins: number, losses: number, ties = 0): number {
  const games = wins + losses + ties;
  return games > 0 ? (wins + ties / 2) / games : 0;
}

/**
 * Compares a team's score against every other team's score for one week
 */
function weekVsAll(teams: TeamStats[], team: TeamStats, week: number) {
  const teamScore = team.weeklyScores[week] || 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  teams.forEach((opponent) => {
    if (opponent.username === team.username) return;
    const opponentScore = opponent.weeklyScores[week] || 0;
    if (teamScore > opponentScore) wins++;
    else if (teamScore < opponentScore) losses++;
    else ties++;
  });
  return { wins, losses, ties };
}

/**
 * Calculates hypothetical "play everyone" statistics
 *
 * Determines how each team would perform if they played all other teams
 * every week, comparing actual wins to hypothetical wins. Ties count as half
 * a win when comparing the two.
 *
 * @param teams - Array of team statistics
 * @param maxWeek - Optional maximum week to consider (only count completed weeks)
 * @returns Array of play-everyone statistics
 */
export function calculatePlayEveryoneStats(teams: TeamStats[], maxWeek?: number): PlayEveryoneStats[] {
  const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, teams[0]?.weeklyScores.length || 0) : teams[0]?.weeklyScores.length || 0;
  const opponents = Math.max(teams.length - 1, 1);

  return teams.map((team) => {
    let playAllWins = 0;
    let playAllLosses = 0;
    let playAllTies = 0;

    for (let week = 0; week < numWeeks; week++) {
      const { wins, losses, ties } = weekVsAll(teams, team, week);
      playAllWins += wins;
      playAllLosses += losses;
      playAllTies += ties;
    }

    // Normalize to per-week basis: play-all results / number of opponents
    const expectedWins = (playAllWins + playAllTies / 2) / opponents;

    return {
      username: team.username,
      teamName: team.teamName,
      actualWins: team.wins,
      actualLosses: team.losses,
      actualTies: team.ties ?? 0,
      playAllWins,
      playAllLosses,
      playAllTies,
      expectedWins,
      difference: team.wins + (team.ties ?? 0) / 2 - expectedWins,
    };
  });
}

/**
 * Calculates detailed weekly play-all statistics
 *
 * For each week, determines how each team would perform if they played
 * all other teams, including win percentage and record. Ties count as half
 * a win in win percentages.
 *
 * @param teams - Array of team statistics
 * @param maxWeek - Optional maximum week to consider (only count completed weeks)
 * @returns Array of weekly play-all stats sorted by overall win percentage
 */
export function calculateWeeklyPlayAll(teams: TeamStats[], maxWeek?: number): WeeklyPlayAllStats[] {
  const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, teams[0]?.weeklyScores.length || 0) : teams[0]?.weeklyScores.length || 0;

  const results = teams.map((team) => {
    const weeklyRecords: WeeklyPlayAllRecord[] = [];
    let totalWins = 0;
    let totalLosses = 0;
    let totalTies = 0;

    for (let week = 0; week < numWeeks; week++) {
      const { wins, losses, ties } = weekVsAll(teams, team, week);

      weeklyRecords.push({
        week: week + 1,
        wins,
        losses,
        ties,
        winPct: winPercentage(wins, losses, ties),
        actualResult: team.weeklyResults?.[week] ?? null,
      });

      totalWins += wins;
      totalLosses += losses;
      totalTies += ties;
    }

    return {
      username: team.username,
      teamName: team.teamName,
      weeklyRecords,
      totalWins,
      totalLosses,
      totalTies,
      overallWinPct: winPercentage(totalWins, totalLosses, totalTies),
    };
  });

  // Sort by overall win percentage (descending)
  return results.sort((a, b) => b.overallWinPct - a.overallWinPct);
}
