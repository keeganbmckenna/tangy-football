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
  /** Its biggest plays (biggestPlays), in time order */
  events?: PlayEvent[];
}

export interface WinHistory {
  season: string;
  week: number;
  /** Sample times (Unix seconds): every few minutes while any game was on */
  times: number[];
  matchups: WinHistoryMatchup[];
}

/** A play (or, saved live, a couple of minutes of plays) in one matchup, and what it did */
export interface PlayEvent {
  /** Unix seconds */
  t: number;
  /** The play-by-play description; null for live events, which only see points change */
  desc: string | null;
  /** The starters whose points it changed, by side (a is the matchup's a) */
  players: Array<{ side: 'a' | 'b'; name: string; pts: number }>;
  /** a's win odds just before and just after */
  before: number;
  after: number;
}

/** A play counts as big if it's worth this many points to one side's starters... */
export const BIG_PLAY_POINTS = 6;
/** ...or moves the win odds this much */
export const BIG_PLAY_ODDS = 0.1;
/** At most this many per matchup, biggest first */
export const BIG_PLAYS_SHOWN = 8;

/** What a play was worth to one side: its starters' points from it, added up */
export const sidePoints = (e: PlayEvent, side: 'a' | 'b') => e.players.filter((p) => p.side === side).reduce((s, p) => s + p.pts, 0);

export const isBigPlay = (e: PlayEvent) =>
  Math.max(Math.abs(sidePoints(e, 'a')), Math.abs(sidePoints(e, 'b'))) >= BIG_PLAY_POINTS || Math.abs(e.after - e.before) >= BIG_PLAY_ODDS;

/** The biggest plays, by how much they moved the odds (then points), in time order */
export function biggestPlays(events: PlayEvent[], n = BIG_PLAYS_SHOWN): PlayEvent[] {
  const size = (e: PlayEvent) => Math.abs(e.after - e.before) + Math.max(Math.abs(sidePoints(e, 'a')), Math.abs(sidePoints(e, 'b'))) / 1000;
  return events
    .filter(isBigPlay)
    .sort((x, y) => size(y) - size(x))
    .slice(0, n)
    .sort((x, y) => x.t - y.t);
}

/**
 * A play-by-play description, readable: without the game clock, formation notes, players
 * reporting as eligible and jersey numbers ("(8:01) (Shotgun) 28-J.Taylor right end for 3
 * yards, TOUCHDOWN." becomes "J.Taylor right end for 3 yards, TOUCHDOWN.")
 */
export function cleanPlay(desc: string): string {
  return desc
    .replace(/^\(\d{1,2}:\d{2}\)\s*/, '')
    .replace(/\((?:No Huddle|Shotgun|Pistol|Under Center)(?:,\s*(?:No Huddle|Shotgun|Pistol|Under Center))*\)\s*/g, '')
    .replace(/\d{1,2}-[A-Z][A-Za-z'.-]* reported in as eligible\.?\s*/g, '')
    .replace(/(?:^|\s)[A-Z]{2,3}-\d{1,2}-[A-Z][A-Za-z'.-]* was injured during the play\.?/g, '')
    .replace(/\b\d{1,2}-(?=[A-Z][a-z]?\.)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a live save sees: each starter's points and each matchup's odds at a moment */
export interface LiveState {
  t: number;
  pts: Record<string, number>;
  odds: Record<number, number>;
}

/**
 * Big moments between two live saves, per matchup: live saves don't see plays, only each
 * starter's points every couple of minutes, so an event is everything that changed in between
 * (desc null), kept when it's big (isBigPlay)
 */
export function liveEvents(
  prev: LiveState,
  now: LiveState,
  matchups: Array<{ matchupId: number; a: string[]; b: string[] }>,
  nameOf: (id: string) => string
): Array<{ matchupId: number; event: PlayEvent }> {
  const out: Array<{ matchupId: number; event: PlayEvent }> = [];
  for (const m of matchups) {
    const before = prev.odds[m.matchupId];
    const after = now.odds[m.matchupId];
    if (before === undefined || after === undefined) continue;
    const players: PlayEvent['players'] = [];
    for (const [side, ids] of [['a', m.a], ['b', m.b]] as const) {
      for (const id of ids) {
        const pts = Math.round(((now.pts[id] ?? 0) - (prev.pts[id] ?? 0)) * 10) / 10;
        if (Math.abs(pts) >= 0.1) players.push({ side, name: nameOf(id), pts });
      }
    }
    const event: PlayEvent = { t: now.t, desc: null, players, before, after };
    if (players.length && isBigPlay(event)) out.push({ matchupId: m.matchupId, event });
  }
  return out;
}

/** How long after a score a correction can still take it back (a flag, a review, a stat fix) */
const RETRACTION_SECONDS = 20 * 60;

/**
 * Drop scores that were taken back: a live event where a player gained points, and a later one
 * (within RETRACTION_SECONDS) where he lost about as many, cancel out. Replays never need this:
 * the play-by-play records a wiped-out play as no play.
 */
export function dropRetractions(events: PlayEvent[]): PlayEvent[] {
  const sorted = [...events].sort((x, y) => x.t - y.t);
  const dropped = new Set<PlayEvent>();
  for (const later of sorted) {
    for (const lost of later.players.filter((p) => p.pts <= -BIG_PLAY_POINTS / 2)) {
      const earlier = sorted.find(
        (e) =>
          !dropped.has(e) &&
          e !== later &&
          e.t < later.t &&
          later.t - e.t <= RETRACTION_SECONDS &&
          e.players.some((p) => p.name === lost.name && p.side === lost.side && Math.abs(p.pts + lost.pts) <= Math.max(1, Math.abs(p.pts) * 0.2))
      );
      if (earlier) {
        dropped.add(earlier);
        dropped.add(later);
      }
    }
  }
  return sorted.filter((e) => !dropped.has(e));
}
