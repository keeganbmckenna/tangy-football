/**
 * Live (in-progress week) views: play-all at the current scores and standings
 * as if the week ended now.
 */

import type { DivisionStanding, LeagueData, SleeperMatchup, TeamStats, WeeklyPlayAllRecord, WildCardStanding } from '../types';
import { calculateTeamStats, rankTeams } from './teamStats';
import { calculateDivisionStandings, calculateWildCardStandings } from './playoffs';
import { calculateWeeklyPlayAll } from './playEveryone';

/** Response of /api/live */
export interface LiveWeekData {
  season: string;
  /** Sleeper's current week */
  week: number;
  lastScoredWeek: number;
  playoffWeekStart: number;
  matchups: SleeperMatchup[];
  fetchedAt: string;
}

/**
 * The week in progress, or null when none is: Sleeper's current week once it's
 * past the last scored week, during the regular season.
 */
export function liveWeekNumber(week: number, lastScoredWeek: number, regularSeasonEnd: number): number | null {
  if (week <= 0 || week <= lastScoredWeek || week > regularSeasonEnd) return null;
  return week;
}

/**
 * Live result of a real matchup at the current scores. Equal scores,
 * including two teams both still at 0, are a tie.
 */
export function liveResult(score: number, opponentScore: number): 'W' | 'L' | 'T' {
  return score > opponentScore ? 'W' : score < opponentScore ? 'L' : 'T';
}

/** League data with the given week's matchups replaced by live ones */
export function withLiveMatchups(data: LeagueData, week: number, matchups: SleeperMatchup[]): LeagueData {
  return { ...data, matchups: { ...data.matchups, [week]: matchups } };
}

export interface LiveMatchupStatus {
  rosterId: number;
  score: number;
  opponentRosterId: number | null;
  opponentScore: number | null;
  /** Currently ahead, behind or level in the real matchup */
  result: 'W' | 'L' | 'T' | null;
}

/** Each roster's real matchup at the current scores */
export function liveMatchupStatus(matchups: SleeperMatchup[]): Map<number, LiveMatchupStatus> {
  const byId = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    if (m.matchup_id == null) continue;
    byId.set(m.matchup_id, [...(byId.get(m.matchup_id) ?? []), m]);
  }
  const status = new Map<number, LiveMatchupStatus>();
  for (const m of matchups) {
    const opp = m.matchup_id == null
      ? undefined
      : byId.get(m.matchup_id)?.find((o) => o.roster_id !== m.roster_id);
    const score = m.points ?? 0;
    const oppScore = opp ? opp.points ?? 0 : null;
    status.set(m.roster_id, {
      rosterId: m.roster_id,
      score,
      opponentRosterId: opp?.roster_id ?? null,
      opponentScore: oppScore,
      result: oppScore === null ? null : liveResult(score, oppScore),
    });
  }
  return status;
}

export interface LivePlayAllRow {
  team: TeamStats;
  score: number;
  /** This week's record against every other team at the current scores */
  week: WeeklyPlayAllRecord;
  /** Season play-all through this week, counting the live week as if final */
  seasonWins: number;
  seasonLosses: number;
  seasonTies: number;
  seasonWinPct: number;
}

/**
 * Play-all for the live week. teams must come from league data that includes
 * the live week's matchups (see withLiveMatchups). Sorted by current score.
 */
export function livePlayAll(teams: TeamStats[], week: number): LivePlayAllRow[] {
  return calculateWeeklyPlayAll(teams, week)
    .filter((row) => row.weeklyRecords[week - 1] !== undefined)
    .map((row) => {
      const team = teams.find((t) => t.username === row.username)!;
      const record = row.weeklyRecords[week - 1];
      const score = team.weeklyScores[week - 1] ?? 0;
      const opponent = team.weeklyOpponentScores[week - 1];
      return {
        team,
        score,
        week: { ...record, actualResult: opponent === undefined ? null : liveResult(score, opponent) },
        seasonWins: row.totalWins,
        seasonLosses: row.totalLosses,
        seasonTies: row.totalTies,
        seasonWinPct: row.overallWinPct,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export type PlayoffStatus = 'division' | 'wildcard' | 'in' | 'out';

export interface LiveStandingRow {
  /** Team as it would stand if the week ended now */
  team: TeamStats;
  before: { rank: number; wins: number; losses: number; ties: number; status: PlayoffStatus };
  now: { rank: number; wins: number; losses: number; ties: number; status: PlayoffStatus };
  liveResult: 'W' | 'L' | 'T' | null;
}

export interface LiveStandings {
  rows: LiveStandingRow[];
  /** As if the week ended now, same shape as the Overview tab's standings */
  standings: TeamStats[];
  divisions: DivisionStanding[];
  wildCard: WildCardStanding[];
}

/**
 * Playoff picture for ranked teams, built the same way as the Overview tab:
 * division leaders, then the wild card race among everyone else.
 */
function playoffPicture(teams: TeamStats[], playoffTeams: number, hasDivisions: boolean) {
  const status = new Map<number, PlayoffStatus>();
  if (!hasDivisions) {
    teams.forEach((t) => status.set(t.rosterId, t.standing <= playoffTeams ? 'in' : 'out'));
    return { status, divisions: [] as DivisionStanding[], wildCard: [] as WildCardStanding[] };
  }
  const divisions = calculateDivisionStandings(teams);
  const wildCard = calculateWildCardStandings(teams, playoffTeams);
  teams.forEach((t) => status.set(t.rosterId, t.isDivisionLeader ? 'division' : 'out'));
  wildCard.forEach((w) => {
    if (w.isIn) status.set(w.team.rosterId, 'wildcard');
  });
  return { status, divisions, wildCard };
}

/**
 * Standings before the live week and as if it ended at the current scores.
 * teams must come from league data that includes the live week's matchups;
 * their wins/losses/points (from Sleeper roster settings) don't include it yet.
 */
export function liveStandings(
  teams: TeamStats[],
  week: number,
  playoffTeams: number,
  hasDivisions: boolean
): LiveStandings {
  // Copies, since ranking and playoff calculations mutate teams
  const before = rankTeams(teams.map((t) => ({ ...t })));
  const beforeStatus = playoffPicture(before, playoffTeams, hasDivisions).status;

  const now = rankTeams(
    teams.map((t) => {
      const score = t.weeklyScores[week - 1] ?? 0;
      const opponent = t.weeklyOpponentScores[week - 1];
      const result = opponent === undefined ? null : liveResult(score, opponent);
      return {
        ...t,
        wins: t.wins + (result === 'W' ? 1 : 0),
        losses: t.losses + (result === 'L' ? 1 : 0),
        ties: t.ties + (result === 'T' ? 1 : 0),
        totalPoints: t.totalPoints + score,
      };
    })
  );
  const picture = playoffPicture(now, playoffTeams, hasDivisions);
  const nowStatus = picture.status;

  const beforeById = new Map(before.map((t) => [t.rosterId, t]));
  const rows = now.map((t) => {
    const b = beforeById.get(t.rosterId)!;
    return {
      team: t,
      before: { rank: b.standing, wins: b.wins, losses: b.losses, ties: b.ties, status: beforeStatus.get(t.rosterId)! },
      now: { rank: t.standing, wins: t.wins, losses: t.losses, ties: t.ties, status: nowStatus.get(t.rosterId)! },
      liveResult: (() => {
        const opponent = t.weeklyOpponentScores[week - 1];
        return opponent === undefined ? null : liveResult(t.weeklyScores[week - 1] ?? 0, opponent);
      })(),
    };
  });
  return { rows, standings: now, divisions: picture.divisions, wildCard: picture.wildCard };
}

/** Team stats including the live week's scores (wins/losses still pre-week) */
export function liveTeamStats(data: LeagueData, live: LiveWeekData): TeamStats[] {
  return calculateTeamStats(withLiveMatchups(data, live.week, live.matchups), live.lastScoredWeek);
}
