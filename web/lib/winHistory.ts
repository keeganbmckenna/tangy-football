/**
 * Each matchup's live win odds through a finished week, replayed from the play-by-play with
 * the Live tab's model (scripts/build-win-history.ts), pre-built into
 * public/data/win-history/{season}/{week}.json.
 */

export interface WinHistoryMatchup {
  matchupId: number;
  /** Roster IDs; odds are a's */
  a: number;
  b: number;
  /** a's chance of winning at each time */
  odds: number[];
  /** [a's score, b's score] at each time */
  scores: Array<[number, number]>;
}

export interface WinHistory {
  season: string;
  week: number;
  /** Sample times (Unix seconds): every few minutes while any game was on */
  times: number[];
  matchups: WinHistoryMatchup[];
}
