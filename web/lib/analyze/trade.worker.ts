/**
 * Runs the season simulation off the main thread so the page stays responsive (20,000 seasons
 * take about 0.4s): the trade tools, and What If while it follows the live week.
 */
import { simulatePlayoffOdds, type LiveGameOdds, type OddsTeam, type PlayoffFormat, type RemainingGame } from './playoffOdds';

export interface OddsRequest {
  id: number;
  teams: OddsTeam[];
  remaining: RemainingGame[];
  format: PlayoffFormat;
  meanByWeek: Record<number, Record<number, number>>;
  spread: number;
  /** Persistent team uncertainty (simulatePlayoffOdds teamSpread) */
  teamSpread: number;
  sims: number;
  seed: number;
  /** Undefined: no bracket played out (What If only needs playoff and bye odds) */
  playoffWeekStart?: number;
  toiletBowl: boolean;
  /** Games in the week being played (simulatePlayoffOdds live) */
  live?: LiveGameOdds[];
  /** Results fixed in every run, game index -> winner (simulatePlayoffOdds forced; What If's picks) */
  forced?: Record<number, number>;
}

// The worker global, without pulling the WebWorker lib into the app's DOM types
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<OddsRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = (event) => {
  const r = event.data;
  const result = simulatePlayoffOdds(r.teams, r.remaining, r.format, r.meanByWeek, r.spread, r.sims, r.seed, r.playoffWeekStart, r.toiletBowl, r.teamSpread, r.forced, r.live);
  ctx.postMessage({ id: r.id, result });
};
