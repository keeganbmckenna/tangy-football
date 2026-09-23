/**
 * Fantasy Football Analytics - Data Analysis Functions
 *
 * This module contains all calculation and data transformation logic
 * for fantasy football league statistics and visualizations.
 */

export { getAvatarUrl, getCustomTeamName, getTeamName } from './teamIdentity';
export { calculateTeamStats } from './teamStats';
export { getWeeklyMatchups } from './matchups';
export {
  calculateCumulativeWins,
  calculateCumulativeScores,
  calculateStandingsOverTime,
  calculateWeeklyRankings,
} from './timeSeries';
export { calculateWeeklyMedians, calculateDifferenceFromMedian } from './median';
export { calculatePlayEveryoneStats, calculateWeeklyPlayAll } from './playEveryone';
export { simulateScheduleLuck } from './scheduleLuck';
export { calculateDivisionStandings, calculateWildCardStandings } from './playoffs';
export { buildPostseasonBrackets } from './brackets';
export { median, buildSnakeBoard, buildAuctionBoardByTeam, summarizeDraftByTeam, positionBadgeClass } from './draft';
export type { DraftData, DraftPickData, SnakeBoardRow, AuctionTeamBoard, DraftTeamSummary } from './draft';
