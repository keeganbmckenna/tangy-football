/**
 * When an injured player is likely back. Sleeper projects a player who's out for every
 * later week as if he'll be back next week (Lamar Jackson, out two games with no return
 * date, was projected for 22 points every week from the next one on), so the odds model
 * scales those weeks by his chance of being back by then.
 *
 * Measured on 2018-2025 (scripts/backtests/returns.py) among QB/RB/WR/TE who'd been playing and
 * were projected 5+ points the week before: of absences that ended that season, 66% played their
 * team's next game; after two in a row, 44%; after three or more, 43% (flat from there; three
 * and four-plus pooled). The discount only applies to players Sleeper projects to be back next
 * week, which leaves out season-ending injuries, so these are the rates for injuries that end
 * (all absences, season-ending included: 55%, 30%, 23%, 16%). Leaving each season out, these beat
 * the earlier rates (76%, 40%, 38%, 48%, from a run that wasn't kept) in 5 of 8 seasons scored on
 * absences that ended and 8 of 8 on all absences.
 */

/** Chance a player plays his team's next game, by how many in a row he's missed (1, 2, 3, 4+) */
export const RETURN_RATE = [0.66, 0.44, 0.43, 0.43];
/** Players on injured reserve sit at least this many games */
export const IR_MIN_GAMES = 4;
/** Statuses that mean a player won't play (doubtful counts when he's projected for nothing this week) */
export const INJURED = new Set(['Out', 'IR', 'PUP', 'Doubtful']);

/** Chance he plays the next game after missing this many in a row */
export function returnRate(missed: number, onIR: boolean): number {
  if (missed <= 0) return 1;
  if (onIR && missed < IR_MIN_GAMES) return 0;
  return RETURN_RATE[Math.min(missed, RETURN_RATE.length) - 1];
}

/** Chance he's back by his team's `gamesAhead`-th game from now, having missed `missed` in a row so far */
export function backBy(missed: number, gamesAhead: number, onIR: boolean): number {
  let stillOut = 1;
  for (let i = 0; i < gamesAhead; i++) stillOut *= 1 - returnRate(missed + i, onIR);
  return 1 - stillOut;
}

/** Games in a row a player has missed: his team's most recent games he didn't play, counting back to one he did */
export function missedStreak(teamWeeks: number[], played: Set<number>): number {
  let n = 0;
  for (let i = teamWeeks.length - 1; i >= 0; i--) {
    if (played.has(teamWeeks[i])) break;
    n++;
  }
  return n;
}
