import { ScheduleLuckSimulation, TeamStats } from '../types';

const BYE_TEAM = -1;

const shuffleArray = <T>(items: T[], random: () => number = Math.random): T[] => {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
};

const buildRoundRobinSchedule = (teamIds: number[]): number[][][] => {
  const teams = teamIds.length % 2 === 0 ? [...teamIds] : [...teamIds, BYE_TEAM];
  const totalTeams = teams.length;
  const half = totalTeams / 2;
  const weeks: number[][][] = [];
  let rotation = [...teams];

  for (let week = 0; week < totalTeams - 1; week++) {
    const matchups: number[][] = [];

    for (let index = 0; index < half; index++) {
      const home = rotation[index];
      const away = rotation[totalTeams - 1 - index];
      if (home !== BYE_TEAM && away !== BYE_TEAM) {
        matchups.push([home, away]);
      }
    }

    weeks.push(matchups);
    rotation = [rotation[0], rotation[totalTeams - 1], ...rotation.slice(1, totalTeams - 1)];
  }

  return weeks;
};

/** What the simulation needs of a team: its weekly scores and its real record */
export type ScheduleLuckTeam = Pick<TeamStats, 'username' | 'teamName' | 'wins' | 'ties' | 'weeklyScores'>;

const getActualWins = (team: ScheduleLuckTeam) => team.wins + (team.ties || 0) * 0.5;

const buildSimulationSchedule = (baseSchedule: number[][][], totalWeeks: number) => {
  if (totalWeeks <= baseSchedule.length) {
    return baseSchedule.slice(0, totalWeeks);
  }

  const schedule = [...baseSchedule];
  const repeatsNeeded = totalWeeks - baseSchedule.length;

  for (let index = 0; index < repeatsNeeded; index++) {
    schedule.push(baseSchedule[index % baseSchedule.length]);
  }

  return schedule;
};

/**
 * Simulates randomized schedules and returns win distributions per team.
 *
 * Uses a round-robin schedule, then repeats early weeks if needed.
 */
export function simulateScheduleLuck(
  teams: ScheduleLuckTeam[],
  simulations: number = 5000,
  maxWeek?: number,
  random: () => number = Math.random
): ScheduleLuckSimulation {
  if (teams.length === 0) {
    return { simulations, weeksSimulated: 0, teams: [] };
  }

  const totalWeeks = teams[0]?.weeklyScores.length || 0;
  const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, totalWeeks) : totalWeeks;
  const teamIds = teams.map((_, index) => index);
  const actualWins = teams.map(getActualWins);
  const distributions = teamIds.map(() => new Map<number, number>());

  for (let sim = 0; sim < simulations; sim++) {
    const shuffledTeams = shuffleArray(teamIds, random);
    const baseSchedule = buildRoundRobinSchedule(shuffledTeams);
    const schedule = buildSimulationSchedule(baseSchedule, numWeeks);
    const wins = new Array(teamIds.length).fill(0);

    for (let week = 0; week < numWeeks; week++) {
      const matchups = schedule[week] ?? [];
      matchups.forEach(([home, away]) => {
        const homeScore = teams[home].weeklyScores[week] ?? 0;
        const awayScore = teams[away].weeklyScores[week] ?? 0;

        if (homeScore > awayScore) {
          wins[home] += 1;
        } else if (awayScore > homeScore) {
          wins[away] += 1;
        } else {
          wins[home] += 0.5;
          wins[away] += 0.5;
        }
      });
    }

    wins.forEach((winTotal, index) => {
      const current = distributions[index].get(winTotal) ?? 0;
      distributions[index].set(winTotal, current + 1);
    });
  }

  const teamsWithDistributions = teams.map((team, index) => {
    const outcomes = Array.from(distributions[index].entries())
      .map(([wins, count]) => ({
        wins,
        count,
        frequency: count / simulations,
      }))
      .sort((a, b) => a.wins - b.wins);

    return {
      username: team.username,
      teamName: team.teamName,
      actualWins: actualWins[index],
      outcomes,
    };
  });

  return {
    simulations,
    weeksSimulated: numWeeks,
    teams: teamsWithDistributions,
  };
}
