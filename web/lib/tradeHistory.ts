/**
 * Server-side trade history for one season: each completed trade graded two
 * ways.
 *
 * - At the time: the playoff-odds model re-run the week of the trade, with the
 *   records, rosters, projections and season production from then, without
 *   and with the trade. Projections are that week's, carried forward to later
 *   weeks with each NFL team's byes (what was knowable when the trade was
 *   made, and how the model was backtested).
 * - Hindsight: the points the players each team received scored in its
 *   starting lineup for the rest of the regular season.
 */

import { SLEEPER_CONFIG, CACHE_CONFIG } from '@/lib/config';
import type { SleeperLeague, SleeperMatchup, SleeperRoster, SleeperTransaction } from '@/lib/types';
import {
  cumulativeProduction,
  fetchJson,
  playoffFormat,
  teamsPlaying,
  weekProjections,
  type ProjectedPlayer,
  type SeasonProduction,
} from '@/lib/oddsData';
import {
  bestLineupPoints,
  streamValues,
  playerValue,
  seedTeams,
  teamStrength,
  type OddsTeam,
  type RemainingGame,
} from '@/lib/analyze/playoffOdds';
import {
  meansAfterTrade,
  parseTrades,
  starterPoints,
  tradeSeasonOdds,
  type RosterChange,
  type TradeHistoryEntry,
  type TradeHistoryResponse,
  type TradeInputs,
} from '@/lib/analyze/trade';

/** Fewer runs than the live odds: each past trade needs two, and the paired draws keep the difference steady */
const HISTORY_SIMS = 5000;

const record = (matchups: Record<number, SleeperMatchup[]>, rosterId: number, throughWeek: number) => {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let pointsFor = 0;
  const scores: number[] = [];
  for (let w = 1; w <= throughWeek; w++) {
    const week = matchups[w] ?? [];
    const m = week.find((x) => x.roster_id === rosterId);
    if (!m) continue;
    const o = week.find((x) => x.matchup_id === m.matchup_id && x.roster_id !== rosterId);
    scores.push(m.points ?? 0);
    pointsFor += m.points ?? 0;
    if (!o) continue;
    if (m.points > o.points) wins++;
    else if (m.points < o.points) losses++;
    else ties++;
  }
  return { wins, losses, ties, pointsFor, scores };
};

const gamesFrom = (matchups: Record<number, SleeperMatchup[]>, fromWeek: number, toWeek: number): RemainingGame[] => {
  const games: RemainingGame[] = [];
  for (let w = fromWeek; w <= toWeek; w++) {
    const pairs = new Map<number, number[]>();
    for (const m of matchups[w] ?? []) {
      if (m.matchup_id == null) continue;
      pairs.set(m.matchup_id, [...(pairs.get(m.matchup_id) ?? []), m.roster_id]);
    }
    pairs.forEach((p) => {
      if (p.length === 2) games.push({ week: w, a: p[0], b: p[1] });
    });
  }
  return games;
};

export async function buildTradeHistory(league: SleeperLeague): Promise<TradeHistoryResponse> {
  const { baseUrl } = SLEEPER_CONFIG;
  const id = league.league_id;
  const settings = league.settings ?? {};
  const playoffWeekStart = settings.playoff_week_start ?? 15;
  const regularSeasonEnd = playoffWeekStart - 1;
  const lastScoredWeek = Math.min(settings.last_scored_leg ?? 0, regularSeasonEnd);
  const complete = lastScoredWeek >= regularSeasonEnd;
  const format = playoffFormat(league);
  const weeks = Array.from({ length: regularSeasonEnd }, (_, i) => i + 1);
  const revalidate = (w: number) => (w <= lastScoredWeek ? CACHE_CONFIG.completedWeek : CACHE_CONFIG.leagueData);

  const [transactions, matchupList, rosters] = await Promise.all([
    Promise.all(weeks.map((w) => fetchJson<SleeperTransaction[]>(`${baseUrl}/league/${id}/transactions/${w}`, revalidate(w)))),
    Promise.all(weeks.map((w) => fetchJson<SleeperMatchup[]>(`${baseUrl}/league/${id}/matchups/${w}`, revalidate(w)))),
    fetchJson<SleeperRoster[]>(`${baseUrl}/league/${id}/rosters`, CACHE_CONFIG.leagueData),
  ]);
  const trades = parseTrades(transactions.flat()).filter((t) => t.week >= 1 && t.week <= regularSeasonEnd);
  const matchups: Record<number, SleeperMatchup[]> = Object.fromEntries(weeks.map((w, i) => [w, matchupList[i]]));
  const division = new Map(rosters.map((r) => [r.roster_id, format.hasDivisions ? r.settings.division ?? 0 : 0]));
  const currentRosters = new Map(rosters.map((r) => [r.roster_id, r.players ?? []]));

  // Sleeper only creates a losers bracket once the playoffs start, so a season
  // in progress goes by last season's
  const previous = !complete && league.previous_league_id
    ? await fetchJson<SleeperLeague>(`${baseUrl}/league/${league.previous_league_id}`, CACHE_CONFIG.completedWeek).catch(() => null)
    : null;
  const hasToiletBowl = !!league.loser_bracket_id || !!previous?.loser_bracket_id;

  // A trade processed during a week can land before or after that week's games:
  // it takes effect the first week the moved players show up on their new teams
  const effectiveWeek = new Map(
    trades.map((t) => {
      const landed = t.sides.some((s) =>
        s.receives.some((p) => matchups[t.week]?.find((m) => m.roster_id === s.rosterId)?.players?.includes(p))
      );
      return [t.id, landed ? t.week : t.week + 1];
    })
  );
  const tradeWeeks = [...new Set([...effectiveWeek.values()].filter((w) => w <= regularSeasonEnd))];
  const [schedule, ...projectionList] = await Promise.all([
    teamsPlaying(league.season),
    ...tradeWeeks.map((w) => weekProjections(league.season, w)),
  ]);
  const projectionsAt = new Map(tradeWeeks.map((w, i) => [w, projectionList[i]]));

  // Each player's season production before each trade week
  const statsWeeks = Math.max(0, ...tradeWeeks.map((w) => w - 1));
  const weeklyStats = await Promise.all(
    Array.from({ length: statsWeeks }, (_, i) =>
      fetchJson<Record<string, { pts_half_ppr?: number; gp?: number }>>(`${baseUrl}/stats/nfl/regular/${league.season}/${i + 1}`, false).catch(
        () => ({}) as Record<string, { pts_half_ppr?: number; gp?: number }>
      )
    )
  );
  const productionBefore = new Map<number, SeasonProduction>(
    tradeWeeks.map((w) => [w, cumulativeProduction(weeklyStats.slice(0, w - 1))])
  );

  const players: TradeHistoryResponse['players'] = {};
  const nameFor = (pid: string, week: number) => {
    if (players[pid]) return;
    const p = projectionsAt.get(week)?.[pid];
    // Team defenses use the team's abbreviation as their ID
    const isDefense = /^[A-Z]{2,3}$/.test(pid);
    players[pid] = { name: p?.name ?? (isDefense ? `${pid} DEF` : pid), position: p?.position ?? (isDefense ? 'DEF' : '') };
  };

  // Final standing order (division winners first), once the regular season is over
  let finalOrder: number[] | null = null;
  if (complete) {
    const finals: OddsTeam[] = rosters.map((r) => {
      const rec = record(matchups, r.roster_id, regularSeasonEnd);
      return { rosterId: r.roster_id, teamName: '', username: '', division: division.get(r.roster_id) ?? 0, ...rec };
    });
    finalOrder = seedTeams(finals, { ...format, playoffTeams: finals.length }).seeds;
  }

  const undo = (roster: string[], side: { receives: string[]; sends: string[] }) => [
    ...roster.filter((p) => !side.receives.includes(p)),
    ...side.sends.filter((p) => !roster.includes(p)),
  ];
  const redo = (roster: string[], side: { receives: string[]; sends: string[] }) => [
    ...roster.filter((p) => !side.sends.includes(p)),
    ...side.receives.filter((p) => !roster.includes(p)),
  ];
  const rostersAround = (tradeId: string, week: number) => {
    const state = new Map<number, string[]>();
    for (const r of rosters) {
      const players = matchups[week]?.find((m) => m.roster_id === r.roster_id)?.players;
      state.set(r.roster_id, players?.length ? players : currentRosters.get(r.roster_id) ?? []);
    }
    const sameWeek = trades.filter((t) => effectiveWeek.get(t.id) === week);
    for (const t of [...sameWeek].reverse()) {
      for (const side of t.sides) state.set(side.rosterId, undo(state.get(side.rosterId) ?? [], side));
    }
    for (const t of sameWeek) {
      const before = new Map(state);
      for (const side of t.sides) state.set(side.rosterId, redo(state.get(side.rosterId) ?? [], side));
      if (t.id === tradeId) return { before, after: new Map(state) };
    }
    return { before: state, after: state };
  };

  const entries: TradeHistoryEntry[] = [];
  for (const trade of trades) {
    // First week the trade counts for
    const w0 = effectiveWeek.get(trade.id)!;
    const proj = projectionsAt.get(w0) ?? null;

    // Rosters right before and after this trade: the week's lineups with that
    // week's trades undone, then replayed in order up to this one
    const { before: beforeRosters, after: afterRosters } = rostersAround(trade.id, w0);
    trade.sides.forEach((s) => [...s.receives, ...s.sends].forEach((p) => nameFor(p, projectionsAt.has(w0) ? w0 : trade.week)));

    let atTime: Map<number, NonNullable<TradeHistoryEntry['sides'][number]['atTime']>> | null = null;
    const remaining = gamesFrom(matchups, w0, regularSeasonEnd);
    if (proj && remaining.length) {
      // That week's projections carried forward, zeroed in each NFL team's bye weeks
      const strengthWeeks = [...new Set(remaining.map((g) => g.week)), playoffWeekStart, playoffWeekStart + 1, playoffWeekStart + 2];
      const plays = (p: ProjectedPlayer, pid: string, w: number) => {
        const playing = schedule?.[w];
        if (!playing) return true;
        return p.position === 'DEF' ? playing.has(pid) : !!p.team && playing.has(p.team);
      };
      // Player values as the odds model sets them: projection blended with season production so far
      const production: SeasonProduction = productionBefore.get(w0) ?? { points: {}, games: {}, playedWeeks: {} };
      const weekProj = (w: number) => {
        const out: Record<string, { position: string; points: number }> = {};
        for (const [pid, p] of Object.entries(proj)) {
          const projected = plays(p, pid, w) ? p.points : 0;
          out[pid] = { position: p.position, points: playerValue(projected, production.points[pid] ?? 0, production.games[pid] ?? 0) };
        }
        return out;
      };
      const projByWeek = Object.fromEntries(strengthWeeks.map((w) => [w, weekProj(w)]));
      const rosterPositions = league.roster_positions ?? [];

      const teams: OddsTeam[] = rosters.map((r) => {
        const rec = record(matchups, r.roster_id, w0 - 1);
        return {
          rosterId: r.roster_id,
          teamName: '',
          username: '',
          division: division.get(r.roster_id) ?? 0,
          wins: rec.wins,
          losses: rec.losses,
          ties: rec.ties,
          pointsFor: rec.pointsFor,
        };
      });
      const weeklyScores = Object.fromEntries(rosters.map((r) => [r.roster_id, record(matchups, r.roster_id, w0 - 1).scores]));
      // Free agents at the time, for streaming (see bestLineup)
      const rostered = new Set([...beforeRosters.values()].flat());
      const streams = Object.fromEntries(strengthWeeks.map((w) => [w, streamValues(projByWeek[w], rostered)]));
      const lineups: Record<number, Record<number, number>> = {};
      for (const w of strengthWeeks) {
        lineups[w] = Object.fromEntries(
          rosters.map((r) => [r.roster_id, bestLineupPoints(beforeRosters.get(r.roster_id) ?? [], projByWeek[w], rosterPositions, streams[w])])
        );
      }
      const { meanByWeek, spread } = teamStrength(weeklyScores, strengthWeeks, lineups);

      const involved = trade.sides.flatMap((s) => [...(beforeRosters.get(s.rosterId) ?? []), ...(afterRosters.get(s.rosterId) ?? [])]);
      const inputs: TradeInputs = {
        weeks: strengthWeeks,
        projections: Object.fromEntries(involved.map((pid) => [pid, Object.fromEntries(strengthWeeks.map((w) => [w, projByWeek[w][pid]?.points ?? 0]))])),
        positions: Object.fromEntries(involved.filter((pid) => proj[pid]).map((pid) => [pid, proj[pid].position])),
        rosters: Object.fromEntries(trade.sides.map((s) => [s.rosterId, beforeRosters.get(s.rosterId) ?? []])),
        freeAgents: [],
        streams,
        rosterPositions,
        lastScoredWeek: w0 - 1,
      };
      const changes: RosterChange[] = trade.sides.map((s) => ({
        rosterId: s.rosterId,
        before: beforeRosters.get(s.rosterId) ?? [],
        after: afterRosters.get(s.rosterId) ?? [],
        dropped: [],
        added: [],
      }));
      const traded = meansAfterTrade(meanByWeek, inputs, changes);
      const odds = tradeSeasonOdds(teams, remaining, format, meanByWeek, traded.meanByWeek, spread, playoffWeekStart, hasToiletBowl, HISTORY_SIMS);
      const regularWeeks = strengthWeeks.filter((w) => w <= regularSeasonEnd);
      atTime = new Map(
        trade.sides.map((s) => {
          const b = odds.before.teams[s.rosterId];
          const a = odds.after.teams[s.rosterId];
          const delta = traded.lineupDelta[s.rosterId] ?? {};
          const perWeek = regularWeeks.length ? regularWeeks.reduce((sum, w) => sum + (delta[w] ?? 0), 0) / regularWeeks.length : 0;
          return [
            s.rosterId,
            {
              before: { playoffs: b.playoffs, champion: b.champion, lastPlace: b.lastPlace },
              after: { playoffs: a.playoffs, champion: a.champion, lastPlace: a.lastPlace },
              lineupPerWeek: Math.round(perWeek * 10) / 10,
            },
          ];
        })
      );
    }

    entries.push({
      id: trade.id,
      week: trade.week,
      effectiveWeek: w0,
      sides: trade.sides.map((s) => ({
        ...s,
        atTime: atTime?.get(s.rosterId) ?? null,
        hindsight: starterPoints(s.receives, s.rosterId, matchups, w0, lastScoredWeek),
        finalSeed: finalOrder ? finalOrder.indexOf(s.rosterId) + 1 : null,
      })),
    });
  }

  return {
    season: league.season,
    playoffTeams: format.playoffTeams,
    throughWeek: lastScoredWeek,
    complete,
    players,
    trades: entries,
    generatedAt: new Date().toISOString(),
  };
}
