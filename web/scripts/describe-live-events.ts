/**
 * Give the week in progress's saved big moments their plays: live saves made before they looked
 * up ESPN's play-by-play (or when it didn't have the play yet) show "Points changed". This
 * matches each one to its game's plays the way the live saves do (matchPlay in lib/winHistory.ts)
 * and updates it in place in Redis, so saves arriving meanwhile aren't touched.
 *
 *   npx tsx --env-file=.env.local scripts/describe-live-events.ts 2026 7
 */

import { SLEEPER_CONFIG } from '../lib/config';
import type { SleeperLeague, SleeperMatchup } from '../lib/types';
import { gamePlays, scoreboard, type EspnPlay } from '../lib/liveData';
import { starterProjections } from '../lib/liveProjections';
import { cleanPlay, matchPlay, PLAY_LOOKBACK_SECONDS, type PlayEvent } from '../lib/winHistory';

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
  const [season, weekArg] = process.argv.slice(2);
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
  const plays = new Map<string, Promise<EspnPlay[]>>();
  const updates: Array<Array<string | number>> = [];
  let done = 0;
  let missing = 0;
  for (const [i, row] of rows.entries()) {
    const { matchupId, event } = JSON.parse(row) as { matchupId: number; event: PlayEvent };
    if (event.desc) continue;
    // The players, by ID: saved ones carry it; older ones only a name, matched within the matchup's starters
    const starters = matchups.filter((m) => m.matchup_id === matchupId).flatMap((m) => m.starters ?? []);
    for (const p of event.players) p.id ??= starters.find((id) => shortName(id) === p.name);
    const top = [...event.players].sort((x, y) => Math.abs(y.pts) - Math.abs(x.pts))[0];
    const proj = top?.id ? projections[top.id] : undefined;
    const espnId = proj?.team ? games[proj.team]?.espnId : undefined;
    if (!proj || proj.position === 'DEF' || !espnId) continue;
    if (!plays.has(espnId)) plays.set(espnId, gamePlays(espnId));
    const lastName = proj.name.split(' ').filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w)).pop() ?? '';
    // The previous save isn't kept with the event: look back a save interval plus the usual window
    const play = matchPlay(event, await plays.get(espnId)!, lastName, event.t - 180 - PLAY_LOOKBACK_SECONDS);
    if (!play) {
      missing++;
      continue;
    }
    updates.push(['LSET', key, i, JSON.stringify({ matchupId, event: { ...event, t: play.t, desc: cleanPlay(play.text) } })]);
    done++;
  }
  if (updates.length) await redis(updates);
  console.log(`${season} week ${week}: ${rows.length} saved moments; ${done} given their play, ${missing} without a match`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
