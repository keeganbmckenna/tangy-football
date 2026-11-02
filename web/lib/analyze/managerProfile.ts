/**
 * One manager's page (History tab): their career totals and where those rank, every season's team,
 * record and finish, their record against each other manager, and their best and worst games.
 * Built from the same league history and record rules as the History tab's tables.
 */

import { allTimeStandings, countsForRecords, headToHead, type AllTimeRow, type HistoryData, type HistoryGame, type RecordOptions } from './history';

export interface ProfileSeason {
  season: string;
  teamName: string;
  avatarUrl: string | null;
  /** Regular-season record (legacy seasons: the final standings) */
  wins: number;
  losses: number;
  ties: number;
  /** Regular-season points per game (null before Sleeper) */
  pointsPerGame: number | null;
  /** Regular-season rank among the season's teams (wins, then points) */
  regularRank: number | null;
  teams: number;
  /** Final placement from the playoff bracket (1 = champion), if any */
  placement: number | null;
  champion: boolean;
  runnerUp: boolean;
  toiletLoser: boolean;
  playoffs: boolean;
  complete: boolean;
}

export interface ProfileOpponent {
  userId: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  /** Average margin per game, from this manager's side */
  margin: number;
}

export interface ProfileGame {
  game: HistoryGame;
  /** This manager's score, the opponent's and who that was */
  pf: number;
  pa: number;
  opponent: string;
}

export interface ManagerProfile {
  userId: string;
  totals: AllTimeRow;
  /** Rank among every manager with games (1 = best) and how many there are */
  ranks: { winPct: number; pointsPerGame: number; titles: number; of: number };
  /** Newest first */
  seasons: ProfileSeason[];
  /** Most games first */
  opponents: ProfileOpponent[];
  /** Worst losing and best winning record against one manager, among series of minSeries+ games */
  nemesis: ProfileOpponent | null;
  favorite: ProfileOpponent | null;
  highest: ProfileGame | null;
  lowest: ProfileGame | null;
  biggestWin: ProfileGame | null;
  worstLoss: ProfileGame | null;
  /** Playoff (winners bracket) games won and lost */
  playoffRecord: { wins: number; losses: number };
}

const rankOf = (rows: AllTimeRow[], userId: string, value: (r: AllTimeRow) => number) => 1 + rows.filter((r) => value(r) > value(rows.find((x) => x.userId === userId)!)).length;

/** The manager's page, or null for someone not in the league's history */
export function managerProfile(data: HistoryData, userId: string, opts: RecordOptions = {}, minSeries = 4): ManagerProfile | null {
  const standings = allTimeStandings(data, opts);
  const totals = standings.find((r) => r.userId === userId);
  if (!totals) return null;
  // Ranks among managers with scored games (points) or any games (records)
  const played = standings.filter((r) => r.games > 0);
  const scored = standings.filter((r) => r.scoredGames > 0);
  const ranks = {
    winPct: totals.games ? rankOf(played, userId, (r) => r.winPct) : played.length,
    pointsPerGame: totals.scoredGames ? rankOf(scored, userId, (r) => r.pointsPerGame) : scored.length,
    titles: rankOf(standings, userId, (r) => r.titles),
    of: played.length,
  };

  const seasons: ProfileSeason[] = [];
  for (const s of data.seasons) {
    const team = s.teams.find((t) => t.userId === userId);
    if (!team) continue;
    let wins = 0;
    let losses = 0;
    let ties = 0;
    let pointsPerGame: number | null = null;
    let regularRank: number | null = null;
    if (s.legacy) {
      const row = s.standings?.find((x) => x.userId === userId);
      wins = row?.wins ?? 0;
      losses = row?.losses ?? 0;
      regularRank = row?.rank ?? null;
    } else {
      // Every team's regular season, for this one's record and rank
      const table = new Map<string, { w: number; l: number; t: number; pf: number; g: number }>();
      for (const g of data.games) {
        if (g.season !== s.season || g.kind !== 'regular') continue;
        for (const [me, pf, pa] of [[g.a, g.pa, g.pb], [g.b, g.pb, g.pa]] as const) {
          const r = table.get(me) ?? { w: 0, l: 0, t: 0, pf: 0, g: 0 };
          r.g++;
          r.pf += pf;
          if (pf > pa) r.w++;
          else if (pf < pa) r.l++;
          else r.t++;
          table.set(me, r);
        }
      }
      const mine = table.get(userId);
      if (mine) {
        wins = mine.w;
        losses = mine.l;
        ties = mine.t;
        pointsPerGame = mine.g ? mine.pf / mine.g : null;
        const pct = (r: { w: number; t: number; g: number }) => (r.w + r.t / 2) / Math.max(r.g, 1);
        regularRank = 1 + [...table.values()].filter((r) => pct(r) > pct(mine) || (pct(r) === pct(mine) && r.pf > mine.pf)).length;
      }
    }
    seasons.push({
      season: s.season,
      teamName: team.teamName,
      avatarUrl: team.avatarUrl,
      wins,
      losses,
      ties,
      pointsPerGame,
      regularRank,
      teams: s.teams.length,
      placement: s.placements[userId] ?? null,
      champion: s.champion === userId,
      runnerUp: s.runnerUp === userId,
      toiletLoser: s.toiletLoser === userId,
      playoffs: s.playoffTeams.includes(userId),
      complete: s.complete,
    });
  }

  const h2h = headToHead(data, opts)[userId] ?? {};
  const opponents: ProfileOpponent[] = Object.entries(h2h)
    .map(([id, c]) => {
      const games = c.games.length;
      return { userId: id, games, wins: c.wins, losses: c.losses, ties: c.ties, winPct: (c.wins + c.ties / 2) / games, margin: (c.pointsFor - c.pointsAgainst) / games };
    })
    .sort((a, b) => b.games - a.games || b.winPct - a.winPct);
  const series = opponents.filter((o) => o.games >= minSeries);
  const losing = series.filter((o) => o.winPct < 0.5);
  const winning = series.filter((o) => o.winPct > 0.5);
  const nemesis = losing.length ? losing.reduce((w, o) => (o.winPct < w.winPct || (o.winPct === w.winPct && o.margin < w.margin) ? o : w)) : null;
  const favorite = winning.length ? winning.reduce((b, o) => (o.winPct > b.winPct || (o.winPct === b.winPct && o.margin > b.margin) ? o : b)) : null;

  // Games for the record book (regular season and playoffs, with scores)
  const mine: ProfileGame[] = data.games
    .filter((g) => countsForRecords(g) && (g.a === userId || g.b === userId) && (g.pa > 0 || g.pb > 0))
    .map((g) => (g.a === userId ? { game: g, pf: g.pa, pa: g.pb, opponent: g.b } : { game: g, pf: g.pb, pa: g.pa, opponent: g.a }));
  const best = (f: (g: ProfileGame) => number, list = mine) => (list.length ? list.reduce((x, g) => (f(g) > f(x) ? g : x)) : null);
  const wins = mine.filter((g) => g.pf > g.pa);
  const losses = mine.filter((g) => g.pf < g.pa);
  const playoffGames = mine.filter((g) => g.game.kind === 'playoff');

  return {
    userId,
    totals,
    ranks,
    seasons,
    opponents,
    nemesis,
    favorite,
    highest: best((g) => g.pf),
    lowest: best((g) => -g.pf),
    biggestWin: best((g) => g.pf - g.pa, wins),
    worstLoss: best((g) => g.pa - g.pf, losses),
    playoffRecord: { wins: playoffGames.filter((g) => g.pf > g.pa).length, losses: playoffGames.filter((g) => g.pf < g.pa).length },
  };
}
