/**
 * What the share cards show (app/share): one matchup's teams, scores, win-odds line and the play
 * that swung it most, or a week's awards and its biggest swing. From the same sources as the site:
 * Sleeper's league data, and the week's win history (the pre-built file once the week's replay is
 * built, the live saves before that).
 */

import { weekAwards, type Award } from '@/lib/analyze/awards';
import { getWeeklyMatchups } from '@/lib/analyze/matchups';
import { getTeamName, teamAvatarUrl } from '@/lib/analyze/teamIdentity';
import { loadLeagueData } from '@/lib/leagueData';
import { readSnapshots } from '@/lib/liveHistory';
import { cleanPlay, type PlayEvent, type WinHistory, type WinHistoryMatchup } from '@/lib/winHistory';
import type { LeagueData, SleeperMatchup } from '@/lib/types';

export interface ShareTeam {
  rosterId: number;
  name: string;
  username: string;
  avatarUrl: string | null;
  score: number;
}

/** The play that moved a matchup's odds most, from the side it helped */
export interface ShareSwing {
  desc: string;
  /** The starters it counted for */
  players: string[];
  /** The team it helped, and that team's odds before and after */
  team: string;
  from: number;
  to: number;
}

export interface ShareMatchup {
  season: string;
  week: number;
  matchupId: number;
  /** Final once Sleeper has scored the week */
  status: 'final' | 'live';
  a: ShareTeam;
  b: ShareTeam;
  /** a's win odds through the week (null without a win history yet) */
  odds: number[] | null;
  swing: ShareSwing | null;
  /** Times the favorite flipped (past 55% the other way), as the chart counts them */
  leadChanges: number;
}

export interface ShareWeek {
  season: string;
  week: number;
  status: 'final' | 'live';
  /** The week's awards (final weeks only) */
  awards: Award[];
  /** The week's biggest single swing, and the matchup it was in */
  swing: (ShareSwing & { matchup: string }) | null;
  games: ShareMatchup[];
}

/** Play text short enough for a card */
const MAX_DESC = 140;
const shortDesc = (desc: string) => {
  const d = cleanPlay(desc);
  return d.length > MAX_DESC ? `${d.slice(0, MAX_DESC - 3).trimEnd()}...` : d;
};

/** The week's win history: the pre-built file for a replayed week, else the live saves */
async function winHistory(origin: string, season: string, week: number): Promise<WinHistory | null> {
  try {
    const res = await fetch(`${origin}/data/win-history/${season}/${week}.json`, { next: { revalidate: 3600 } });
    if (res.ok) return (await res.json()) as WinHistory;
  } catch {
    // Not built yet: the live saves
  }
  return readSnapshots(season, week);
}

/** Lead changes in a's odds: the favorite flipping past 55% the other way */
export function leadChanges(odds: number[]): number {
  let swings = 0;
  let side = 0;
  for (const p of odds) {
    const now = p > 0.55 ? 1 : p < 0.45 ? -1 : 0;
    if (now && side && now !== side) swings++;
    if (now) side = now;
  }
  return swings;
}

/** The play that moved this matchup's odds most */
export function biggestSwing(h: WinHistoryMatchup, nameOf: (rosterId: number) => string): ShareSwing | null {
  const best = (h.events ?? [])
    .filter((e) => e.desc)
    .reduce<PlayEvent | null>((top, e) => (!top || Math.abs(e.after - e.before) > Math.abs(top.after - top.before) ? e : top), null);
  if (!best || Math.abs(best.after - best.before) < 0.01) return null;
  const forA = best.after >= best.before;
  return {
    desc: shortDesc(best.desc!),
    players: best.players.map((p) => p.name),
    team: nameOf(forA ? h.a : h.b),
    from: forA ? best.before : 1 - best.before,
    to: forA ? best.after : 1 - best.after,
  };
}

function team(data: LeagueData, rosterId: number, score: number): ShareTeam {
  const { name, username } = getTeamName(rosterId, data);
  return { rosterId, name: name.trim(), username, avatarUrl: teamAvatarUrl(data, rosterId), score };
}

/** The week's matchups as cards, in matchup order (null for a week that hasn't started) */
async function weekGames(data: LeagueData, origin: string, season: string, week: number): Promise<{ status: 'final' | 'live'; games: ShareMatchup[]; history: WinHistory | null } | null> {
  const sleeper = data.matchups[week];
  if (!sleeper?.length) return null;
  const status = week <= data.lastScoredWeek ? 'final' : 'live';
  // Nothing scored yet: no card to make
  if (status === 'live' && !sleeper.some((m) => (m.points ?? 0) > 0)) return null;
  const history = await winHistory(origin, season, week);
  const pairs = new Map<number, SleeperMatchup[]>();
  for (const m of sleeper) if (m.matchup_id != null) pairs.set(m.matchup_id, [...(pairs.get(m.matchup_id) ?? []), m]);
  const nameOf = (rosterId: number) => getTeamName(rosterId, data).name.trim();
  const games: ShareMatchup[] = [];
  for (const [matchupId, pair] of [...pairs].sort((x, y) => x[0] - y[0])) {
    if (pair.length !== 2) continue;
    const h = history?.matchups.find((x) => x.matchupId === matchupId);
    // The win history's sides when there is one (its odds are a's)
    const [ma, mb] = h && h.a === pair[1].roster_id ? [pair[1], pair[0]] : pair;
    // Live: the latest saved scores (fresher than Sleeper's), final: Sleeper's official ones
    const last = h && status === 'live' ? h.scores[h.scores.length - 1] : null;
    games.push({
      season,
      week,
      matchupId,
      status,
      a: team(data, ma.roster_id, last ? last[0] : ma.points ?? 0),
      b: team(data, mb.roster_id, last ? last[1] : mb.points ?? 0),
      odds: h?.odds.length ? h.odds : null,
      swing: h ? biggestSwing(h, nameOf) : null,
      leadChanges: h ? leadChanges(h.odds) : 0,
    });
  }
  return { status, games, history };
}

const validWeek = (season: string, week: number) => /^\d{4}$/.test(season) && Number.isInteger(week) && week >= 1 && week <= 18;

/** One matchup's card (null if there's no such matchup or it hasn't started) */
export async function shareMatchup(origin: string, season: string, week: number, matchupId: number): Promise<ShareMatchup | null> {
  if (!validWeek(season, week)) return null;
  const data = await loadLeagueData(season);
  if (!data) return null;
  const w = await weekGames(data, origin, season, week);
  return w?.games.find((g) => g.matchupId === matchupId) ?? null;
}

/** A week's card (null for a week that hasn't started) */
export async function shareWeek(origin: string, season: string, week: number): Promise<ShareWeek | null> {
  if (!validWeek(season, week)) return null;
  const data = await loadLeagueData(season);
  if (!data) return null;
  const w = await weekGames(data, origin, season, week);
  if (!w) return null;
  const awards = w.status === 'final' ? weekAwards(getWeeklyMatchups(data)[week] ?? []) : [];
  const swing = w.games
    .filter((g) => g.swing)
    .reduce<ShareWeek['swing']>((top, g) => {
      const s = { ...g.swing!, matchup: `${g.a.name} vs ${g.b.name}` };
      return !top || s.to - s.from > top.to - top.from ? s : top;
    }, null);
  return { season, week, status: w.status, awards, swing, games: w.games };
}

/** The site's own address for a share request (works locally and on Vercel) */
export function originOf(headers: Headers): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'tangy-football.vercel.app';
  const proto = headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
