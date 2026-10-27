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
  /** Its biggest plays (biggestPlays, up to BIG_PLAYS_KEPT), in time order */
  events?: PlayEvent[];
}

export interface WinHistory {
  season: string;
  week: number;
  /** Sample times (Unix seconds): every few minutes while any game was on */
  times: number[];
  matchups: WinHistoryMatchup[];
}

/** A play (or, saved live, what changed between two saves) in one matchup, and what it did */
export interface PlayEvent {
  /** Unix seconds */
  t: number;
  /** The play-by-play description; null for live events, which only see points change */
  desc: string | null;
  /** The starters whose points it changed, by side (a is the matchup's a); id on live saves */
  players: Array<{ side: 'a' | 'b'; name: string; pts: number; id?: string }>;
  /** a's win odds just before and just after */
  before: number;
  after: number;
  /** Live saves: the teams in the play's game, so only those defenses count toward it */
  teams?: string[];
}

/**
 * A play counts as big if it's worth this many points to one side's starters (a touchdown pass,
 * worth 4-5.5 here, included)...
 */
export const BIG_PLAY_POINTS = 4;
/** ...or moves the win odds this much */
export const BIG_PLAY_ODDS = 0.1;
/** At most this many per matchup on the chart, biggest first... */
export const BIG_PLAYS_SHOWN = 8;
/** ...and kept per matchup, for the full-screen chart */
export const BIG_PLAYS_KEPT = 20;

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
 * A play-by-play description, readable: just the play. Drops the game clock, formation notes,
 * players reporting as eligible, jersey numbers and team prefixes, injury notes, QB hits
 * ("[L.Van Ness]"), tacklers ("(T.Bernard)"), a kick's snapper and holder, penalties (a play
 * wiped out by one is never a big play), milestone trivia, and shortens replay reviews to
 * "Upheld on review." or "Reversed on review."
 */
export function cleanPlay(desc: string): string {
  let text = desc
    .replace(/^\(\d{0,2}:\d{2}\)\s*/, '')
    .replace(/\((?:No Huddle|Shotgun|Pistol|Under Center)(?:,\s*(?:No Huddle|Shotgun|Pistol|Under Center))*\)\s*/g, '')
    .replace(/\((?:Punt|Kick|Field Goal|Run|Pass) formation\)\s*/gi, '')
    // "68-B.Jones reported in as eligible" (nflverse) or "B.Jones reported in as eligible" (ESPN)
    .replace(/(?:\d{1,2}-)?[A-Z][A-Za-z'.-]*(?: [A-Z][A-Za-z'.-]*)? reported in as (?:in)?eligible\.?\s*/g, '')
    .replace(/(?:^|\s)[A-Z]{2,3}-\d{1,2}-[A-Z][A-Za-z'.-]* was injured during the play\.?/g, '');
  // Replay reviews: just the outcome (a review cut off before it says is dropped)
  text = text.replace(/\s*The Replay Official reviewed[^.]*?(?:and the play was\s+)?(Upheld|REVERSED|Reversed|confirmed|stands)[^.]*\.?/gi, (_m, outcome: string) =>
    /revers/i.test(outcome) ? ' Reversed on review.' : ' Upheld on review.'
  ).replace(/\s*The Replay Official[\s\S]*$/, '');
  return (
    text
      // Penalties, from where they start to the end of the description
      .replace(/\s*(?:PENALTY|Penalty)\b[\s\S]*$/, '')
      // Milestone trivia ("BAL 89-Andrews 31st career rec TD ...")
      .replace(/\s*[A-Z]{2,3} \d{1,2}-[A-Z][A-Za-z'.-]* \d+(?:st|nd|rd|th) career[\s\S]*$/, '')
      // QB hits and tacklers
      .replace(/\s*\[[^\]]*\]/g, '')
      .replace(/\s*\((?:[A-Z][a-z]?\.\s?[A-Za-z'.-]+(?: [A-Z][a-z]+)?(?:[;,]\s*)?)+\)/g, '')
      // A kick's snapper and holder
      .replace(/,?\s*Center-(?:\d{1,2}-)?[A-Z][a-z]?\.[A-Za-z'-]+(?:,\s*Holder-(?:\d{1,2}-)?[A-Z][a-z]?\.[A-Za-z'-]+)?/g, '')
      .replace(/\b\d{1,2}-(?=[A-Z][a-z]?\.)/g, '')
      .replace(/\b[A-Z]{2,3}-(?=[A-Z][a-z]?\.)/g, '')
      .replace(/\s+([.,])/g, '$1')
      .replace(/\.{2,}/g, '.')
      .replace(/\s+/g, ' ')
      .trim()
      // Older descriptions were cut at 180 characters: an unclosed note, or a word or two left
      // over ("... Upheld on review. T")
      .replace(/\s*\([^)]*$/, '')
      .replace(/(\.)\s+\S{1,3}$/, '$1')
  );
}

/** What a live save sees: each starter's points and each matchup's odds at a moment */
export interface LiveState {
  t: number;
  pts: Record<string, number>;
  odds: Record<number, number>;
  /** The time of each starter's latest play given to a big moment (live saves) */
  played?: Record<string, number>;
}

/**
 * Big moments between two live saves, per matchup: live saves don't see plays, only each
 * starter's points every 30 seconds or so, so an event is everything that changed in between
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
        if (Math.abs(pts) >= 0.1) players.push({ side, name: nameOf(id), pts, id });
      }
    }
    const event: PlayEvent = { t: now.t, desc: null, players, before, after };
    if (players.length && isBigPlay(event)) out.push({ matchupId: m.matchupId, event });
  }
  return out;
}

/** A loss this big can be a score taken back */
const RETRACTED_POINTS = 3;

/** How far back before the previous save a live event's play can be (Sleeper's stats trail the plays) */
export const PLAY_LOOKBACK_SECONDS = 10 * 60;

/**
 * The play behind a live event, from its game's play-by-play: plays naming the player whose points
 * moved most, from PLAY_LOOKBACK_SECONDS before the previous save to now, leaving out plays a
 * penalty wiped out. A move worth a touchdown (4+ points) takes the latest scoring play; a smaller
 * one the longest play that didn't score (so a catch before a touchdown isn't credited with it, and
 * a short run after a long one isn't either).
 */
export function matchPlay(
  event: PlayEvent,
  plays: Array<{ t: number; text: string; scoring: boolean }>,
  lastName: string,
  since: number
): { t: number; text: string } | null {
  const top = [...event.players].sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))[0];
  if (!top || !lastName) return null;
  const name = lastName.toLowerCase();
  // A gain isn't an incomplete pass
  const found = plays.filter(
    (p) => p.t >= since && p.t <= event.t && p.text.toLowerCase().includes(name) && !/no play/i.test(p.text) && !(top.pts > 0 && /incomplete/i.test(p.text))
  );
  const wantScore = Math.abs(top.pts) >= 4;
  // A touchdown's worth: the latest scoring play. Less: the longest play that didn't score (the
  // points are mostly its yards), the latest of equals
  const yards = (text: string) => (/no gain/i.test(text) ? 0 : Number(/for (-?\d+) yards?/i.exec(text)?.[1] ?? 0));
  const scoring = found.filter((p) => p.scoring);
  const other = found.filter((p) => !p.scoring);
  const longest = other.reduce<(typeof found)[number] | undefined>((best, p) => (!best || yards(p.text) >= yards(best.text) ? p : best), undefined);
  const pick = (wantScore ? scoring[scoring.length - 1] : undefined) ?? longest ?? found[found.length - 1];
  return pick ? { t: pick.t, text: pick.text } : null;
}

/** A starter's short name ("M. Lemon", "L. Burden III") as play-by-play writes it ("m.lemon") */
const playName = (name: string) =>
  name.split(' ').filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).join(' ').replace(/^(\S+\.) /, '$1').toLowerCase();

/** A defense's entry: its ID is its team code; older saves without IDs, a name that isn't a player's */
const isDefense = (p: PlayEvent['players'][number]) => (p.id ? /^[A-Z]{2,3}$/.test(p.id) : !/^[A-Z][a-z]?\. /.test(p.name));

/**
 * A live event given its play: just the starters the play names, and the defenses in its game
 * (points allowed move with the other team's scores). A live save sees everything that changed
 * since the last one, so points from other plays in those minutes would otherwise ride along.
 * A defense is kept when its game isn't known; with no player named, the event is left as it was.
 */
export function playersInPlay(event: PlayEvent): PlayEvent {
  if (!event.desc) return event;
  const text = event.desc.toLowerCase();
  const kept = event.players.filter((p) =>
    isDefense(p) ? !event.teams || !p.id || event.teams.includes(p.id) : text.includes(playName(p.name))
  );
  return kept.some((p) => !isDefense(p)) ? { ...event, players: kept } : event;
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
    for (const lost of later.players.filter((p) => p.pts <= -RETRACTED_POINTS)) {
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
