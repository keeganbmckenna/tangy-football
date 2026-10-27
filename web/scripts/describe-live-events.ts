/**
 * Give the week in progress's saved big moments their plays: live saves made before they looked
 * up ESPN's play-by-play (or when it didn't have the play yet) show "Points changed". This
 * matches each one to its game's plays the way the live saves do (matchPlay in lib/winHistory.ts),
 * keeps just the players the play names and its game's defenses (playersInPlay), and updates it
 * in place in Redis, so saves arriving meanwhile aren't touched.
 *
 *   npx tsx --env-file=.env.local scripts/describe-live-events.ts 2026 7 [--redo]
 *
 * --redo matches every moment again, not just those without a play, by points (bestFit below).
 */

import { SLEEPER_CONFIG } from '../lib/config';
import type { SleeperLeague, SleeperMatchup } from '../lib/types';
import { gamePlays, scoreboard, type EspnPlay } from '../lib/liveData';
import { starterProjections } from '../lib/liveProjections';
import { cleanPlay, matchPlay, PLAY_LOOKBACK_SECONDS, playersInPlay, type PlayEvent } from '../lib/winHistory';

const URL_ = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

async function redis(commands: Array<Array<string | number>>): Promise<unknown[]> {
  const res = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}`);
  return ((await res.json()) as Array<{ result?: unknown }>).map((r) => r.result);
}

const getJson = async <T>(url: string): Promise<T> => (await fetch(url)).json() as Promise<T>;

async function main() {
  const [season, weekArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const redo = process.argv.includes('--redo');
  const week = Number(weekArg);
  if (!URL_ || !TOKEN || !season || !week) throw new Error('Usage: describe-live-events.ts SEASON WEEK (with the Redis env vars)');
  const base = SLEEPER_CONFIG.baseUrl;
  const league = await getJson<SleeperLeague>(`${base}/league/${SLEEPER_CONFIG.leagueId}`);
  const matchups = await getJson<SleeperMatchup[]>(`${base}/league/${league.league_id}/matchups/${week}`);
  const games = await scoreboard(season, week, 0);
  if (!games) throw new Error('Scoreboard unavailable');
  const projections = await starterProjections(season, week, week - 1, matchups, games, league.scoring_settings ?? {});
  if (!projections) throw new Error('Projections unavailable');
  const shortName = (id: string) => {
    const p = projections[id];
    return p ? (p.position === 'DEF' ? p.name : p.name.replace(/^(\S)\S*\s+(?=\S)/, '$1. ')) : id;
  };
  const key = `win:${season}:${week}:events`;
  const [rows] = (await redis([['LRANGE', key, 0, -1]])) as [string[]];
  /**
   * --redo: a moment's time may already be a play's, and the saves may since have been replaced by
   * the replay's, so the live save's window can't be rebuilt. Instead, the play within REDO_SECONDS
   * whose rough half-PPR value (yards, touchdowns, catches, kicks) is closest to the player's points,
   * each play credited to a player once.
   */
  const REDO_SECONDS = 15 * 60;
  const worth = (text: string, name: string) => {
    const yards = /no gain/i.test(text) ? 0 : Number(/for (-?\d+) yards?/i.exec(text)?.[1] ?? 0);
    const td = /TOUCHDOWN/.test(text) && !/NULLIFIED|REVERSED/i.test(text);
    const passer = text.toLowerCase().indexOf(name) < text.toLowerCase().indexOf(' pass ') && / pass /i.test(text);
    const fg = /(\d+) yard field goal is GOOD/i.exec(text);
    if (fg) return Number(fg[1]) >= 50 ? 5 : Number(fg[1]) >= 40 ? 4 : 3;
    if (/extra point is GOOD/i.test(text) && text.toLowerCase().indexOf(name) > text.indexOf('TOUCHDOWN')) return 1;
    if (passer) return /incomplete/i.test(text) ? 0 : yards * 0.04 + (td ? 4 : 0) - (/INTERCEPTED/.test(text) ? 1 : 0);
    if (/incomplete/i.test(text)) return 0;
    return yards * 0.1 + (td ? 6 : 0) + (/ pass /i.test(text) ? 0.5 : 0);
  };
  const used = new Set<string>();
  const bestFit = (event: PlayEvent, top: PlayEvent['players'][number], gamePlays: EspnPlay[], espnId: string) => {
    const name = top.name.split(' ').filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).join(' ').replace(/^(\S+\.) /, '$1').toLowerCase();
    let best: { play: EspnPlay; miss: number } | null = null;
    for (const play of gamePlays) {
      const k = `${espnId}:${play.t}:${top.id}`;
      if (used.has(k) || Math.abs(play.t - event.t) > REDO_SECONDS || !play.text.toLowerCase().includes(name) || /no play/i.test(play.text)) continue;
      const miss = Math.abs(worth(play.text, name) - top.pts) + Math.abs(play.t - event.t) / 3600;
      if (!best || miss < best.miss) best = { play, miss };
    }
    if (best) used.add(`${espnId}:${best.play.t}:${top.id}`);
    return best?.play ?? null;
  };
  const plays = new Map<string, Promise<EspnPlay[]>>();
  const updates: Array<Array<string | number>> = [];
  let done = 0;
  let missing = 0;
  // Oldest first, so each play goes to the first moment that fits it
  const order = rows.map((row, i) => ({ i, ...(JSON.parse(row) as { matchupId: number; event: PlayEvent }) })).sort((x, y) => x.event.t - y.event.t);
  for (const { i, matchupId, event } of order) {
    // Described and given its game's teams already
    if (event.desc && event.teams && !redo) continue;
    // The players, by ID: saved ones carry it; older ones only a name, matched within the matchup's starters
    const starters = matchups.filter((m) => m.matchup_id === matchupId).flatMap((m) => m.starters ?? []);
    for (const p of event.players) p.id ??= starters.find((id) => shortName(id) === p.name);
    const top = [...event.players].sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts))[0];
    const proj = top?.id ? projections[top.id] : undefined;
    const espnId = proj?.team ? games[proj.team]?.espnId : undefined;
    if (!proj || proj.position === 'DEF' || !espnId) continue;
    const opponent = games[proj.team!]?.opponent;
    const teams = opponent ? [proj.team!, opponent] : [proj.team!];
    if (!event.desc || redo) {
      if (!plays.has(espnId)) plays.set(espnId, gamePlays(espnId));
      const lastName = proj.name.split(' ').filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).pop() ?? '';
      const play = redo
        ? bestFit(event, top, await plays.get(espnId)!, espnId)
        : // The previous save isn't kept with the event: look back a save interval plus the usual window
          matchPlay(event, await plays.get(espnId)!, lastName, event.t - 180 - PLAY_LOOKBACK_SECONDS);
      if (!play) {
        missing++;
        continue;
      }
      Object.assign(event, { t: play.t, desc: cleanPlay(play.text) });
    }
    updates.push(['LSET', key, i, JSON.stringify({ matchupId, event: playersInPlay({ ...event, teams }) })]);
    done++;
  }
  if (updates.length) await redis(updates);
  console.log(`${season} week ${week}: ${rows.length} saved moments; ${done} given their play, ${missing} without a match`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
