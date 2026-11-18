/**
 * The rows behind the Playoffs tab's "How accurate are the odds?" (lib/analyze/accuracy.ts):
 *
 * - every regular-season matchup's win odds at the week's first kickoff, from the favorite's
 *   side, against who won (public/data/win-history/{season}/{week}.json: the first point of its
 *   odds line, and its final score);
 * - every team's playoff odds each week of a finished season, against whether it made the
 *   playoffs (public/data/odds-history/{season}.json: its last checkpoint is the outcome).
 *
 *   npx tsx scripts/build-accuracy.ts
 *
 * Reads only those files, so it runs after scripts/build-win-history.ts (the win-history
 * workflow runs both every week of the season). Writes public/data/accuracy.json.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AccuracyData, GameRow, PlayoffRow } from '../lib/analyze/accuracy';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

interface WinHistoryFile {
  matchups: Array<{ a: number; b: number; odds: number[]; scores: Array<[number, number]> }>;
}
interface OddsHistoryFile {
  regularSeasonEnd: number;
  complete: boolean;
  checkpoints: Array<{ week: number; odds: Record<string, { playoffs: number }> }>;
}

const numeric = (names: string[]) => names.map((n) => n.replace(/\.json$/, '')).filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => a - b);
const seasons = numeric(readdirSync(join(DATA, 'win-history'))).map(String);
const oddsHistory = (season: string): OddsHistoryFile | null => {
  const path = join(DATA, 'odds-history', `${season}.json`);
  return existsSync(path) ? read<OddsHistoryFile>(path) : null;
};
// A season still being played has no file yet: its regular season ends where the latest one's did
const latestEnd = [...seasons].reverse().map(oddsHistory).find((h) => h)?.regularSeasonEnd ?? 14;

const games: GameRow[] = [];
const playoffs: PlayoffRow[] = [];
for (const season of seasons) {
  const history = oddsHistory(season);
  const regularSeasonEnd = history?.regularSeasonEnd ?? latestEnd;
  for (const week of numeric(readdirSync(join(DATA, 'win-history', season)))) {
    if (week > regularSeasonEnd) continue;
    const file = read<WinHistoryFile>(join(DATA, 'win-history', season, `${week}.json`));
    for (const m of file.matchups) {
      const [pa, pb] = m.scores[m.scores.length - 1] ?? [0, 0];
      // Unplayed or tied: nothing to score
      if (!m.odds.length || pa === pb) continue;
      const aOdds = m.odds[0];
      const aFavored = aOdds >= 0.5;
      games.push({ season, week, p: aFavored ? aOdds : 1 - aOdds, won: aFavored === pa > pb });
    }
  }
  // Playoff odds only for finished seasons: the last checkpoint, after the regular season, is who made it
  if (history?.complete && history.checkpoints.length > 1) {
    const final = history.checkpoints[history.checkpoints.length - 1];
    for (const c of history.checkpoints.slice(0, -1)) {
      for (const [rosterId, o] of Object.entries(c.odds)) {
        const made = final.odds[rosterId]?.playoffs;
        if (made === undefined) continue;
        playoffs.push({ season, week: c.week, p: o.playoffs, made: made >= 0.5 });
      }
    }
  }
}

const out: AccuracyData = { games, playoffs, generatedAt: new Date().toISOString() };
writeFileSync(join(DATA, 'accuracy.json'), JSON.stringify(out));
console.log(`accuracy.json: ${games.length} games (${seasons.join(', ')}), ${playoffs.length} team-weeks of playoff odds`);
