'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import PlayoffRace, { type StandingAnnotation } from '@/components/PlayoffRace';
import ResultDot from '@/components/ui/ResultDot';
import LiveScore from '@/components/ui/LiveScore';
import TeamAvatar from '@/components/ui/TeamAvatar';
import { teamAvatarUrl } from '@/lib/analyze/teamIdentity';
import { formatStatLine } from '@/lib/analyze/statLine';
import MatchupDetail, { type MatchupPlayer, type MatchupSide } from '@/components/MatchupDetail';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import TeamName, { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import { useTableSort } from '@/hooks/useTableSort';
import { sortRows } from '@/lib/tableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { myLiveMatchupFirst } from '@/lib/analyze/myMatchup';
import { getHeatmapColorByRatio, RESULT_DOT_COLORS } from '@/lib/constants';
import { formatRecord } from '@/lib/analyze/playEveryone';
import {
  liveMatchupStatus,
  livePlayAll,
  liveLineup,
  liveWinOdds,
  scoreSpread,
  liveStandings,
  liveTeamStats,
  liveWeekNumber,
  type LiveMatchupOdds,
  type LiveScoresData,
  type LiveSide,
  type LiveWeekData,
  type PlayoffStatus,
} from '@/lib/analyze/live';
import type { LeagueData, TeamStats } from '@/lib/types';

// While a week is in progress and the tab is visible: scores and game clocks every 10
// seconds while an NFL game is being played (once a minute between games), and the rest
// (projections, injury statuses) every 2 minutes
const SCORES_LIVE_MS = 10_000;
const SCORES_IDLE_MS = 60_000;
const FULL_REFRESH_MS = 120_000;

interface LiveTabProps {
  leagueData: LeagueData;
  regularSeasonEnd: number;
  playoffTeams: number;
  hasDivisions: boolean;
}

function isIn(status: PlayoffStatus) {
  return status !== 'out';
}

function TeamCell({ team }: { team: TeamStats }) {
  return <TeamName name={team.teamName} sub={`@${team.username}`} />;
}

const oddsText = (p: number) => (p > 0.995 ? '>99%' : p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);

function SideSummary({ side, name, avatarUrl, align }: { side: LiveSide; name: string; avatarUrl: string | null; align: 'left' | 'right' }) {
  const left = [side.playing && `${side.playing} playing`, side.toPlay && `${side.toPlay} to play`].filter(Boolean).join(' · ') || 'done';
  return (
    <div className={`min-w-0 flex-1 ${align === 'right' ? 'text-right' : ''}`}>
      <div className={`flex items-center gap-2 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <TeamAvatar url={avatarUrl} name={name} size="h-7 w-7" />
        <div className="min-w-0 truncate text-sm font-semibold text-[var(--foreground)]" title={name}>{name}</div>
      </div>
      <div className="text-2xl font-bold tabular-nums text-[var(--foreground)]"><LiveScore value={side.score} align={align} /></div>
      <div className="text-xs tabular-nums text-[var(--muted)]">proj {side.projected.toFixed(1)}</div>
      <div className="whitespace-nowrap text-xs text-[var(--muted)]">{left}</div>
    </div>
  );
}

/** Each real matchup with its live win odds */
function LiveMatchups({
  odds,
  names,
  avatar,
  myRosterId,
  onOpen,
}: {
  odds: LiveMatchupOdds[];
  names: Map<number, string>;
  avatar: (rosterId: number) => string | null;
  myRosterId: number | null;
  onOpen: (matchupId: number) => void;
}) {
  return (
    <div className="grid gap-3 p-4 sm:p-6 md:grid-cols-2">
      {odds.map((m) => {
        const mine = m.a.rosterId === myRosterId || m.b.rosterId === myRosterId;
        const a = m.aWinOdds;
        return (
          <button
            type="button"
            key={m.matchupId}
            onClick={() => onOpen(m.matchupId)}
            aria-label={`${names.get(m.a.rosterId)} vs ${names.get(m.b.rosterId)}: see lineups`}
            className={`rounded-lg border p-3 text-left transition-colors hover:bg-[var(--hover)] ${mine ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
          >
            <div className="flex items-start gap-3">
              <SideSummary side={m.a} name={names.get(m.a.rosterId) ?? `Team ${m.a.rosterId}`} avatarUrl={avatar(m.a.rosterId)} align="left" />
              <SideSummary side={m.b} name={names.get(m.b.rosterId) ?? `Team ${m.b.rosterId}`} avatarUrl={avatar(m.b.rosterId)} align="right" />
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs font-semibold tabular-nums">
              <span className="w-9" style={{ color: a >= 0.5 ? RESULT_DOT_COLORS.W : 'var(--muted)' }}>{oddsText(a)}</span>
              <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--neutral-bg)]" role="img" aria-label={`Win odds ${oddsText(a)} to ${oddsText(1 - a)}`}>
                <div style={{ width: `${a * 100}%`, backgroundColor: a >= 0.5 ? RESULT_DOT_COLORS.W : RESULT_DOT_COLORS.L, transition: 'width .6s ease' }} />
                <div style={{ width: `${(1 - a) * 100}%`, backgroundColor: a < 0.5 ? RESULT_DOT_COLORS.W : RESULT_DOT_COLORS.L, transition: 'width .6s ease' }} />
              </div>
              <span className="w-9 text-right" style={{ color: a <= 0.5 ? RESULT_DOT_COLORS.W : 'var(--muted)' }}>{oddsText(1 - a)}</span>
            </div>
            <div className="mt-1.5 text-center text-[11px] text-[var(--muted)]">Tap for lineups</div>
          </button>
        );
      })}
    </div>
  );
}

function secondsAgo(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

export default function LiveTab({ leagueData, regularSeasonEnd, playoffTeams, hasDivisions }: LiveTabProps) {
  const [live, setLive] = useState<LiveWeekData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The matchup whose lineups are open (it stays live through refreshes)
  const [openMatchup, setOpenMatchup] = useState<number | null>(null);
  const closeMatchup = useCallback(() => setOpenMatchup(null), []);
  // Kept across the minute-by-minute refreshes
  const sort = useTableSort('livePlayAll');
  const me = useMyTeam();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/live', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load live data');
      setLive((await res.json()) as LiveWeekData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load live data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Just scores and clocks, merged into the last full load
  const refreshScores = useCallback(async () => {
    try {
      const res = await fetch('/api/live/scores');
      if (!res.ok) return;
      const data = (await res.json()) as LiveScoresData;
      setLive((prev) =>
        prev && prev.week === data.week
          ? {
              ...prev,
              matchups: data.matchups,
              games: data.games ?? prev.games,
              allowed: data.allowed ?? prev.allowed,
              stats: data.stats ?? prev.stats,
              fetchedAt: data.fetchedAt,
            }
          : prev
      );
    } catch {
      // The next poll or full refresh catches up
    }
  }, []);

  const week = live ? liveWeekNumber(live.week, live.lastScoredWeek, regularSeasonEnd) : null;
  const gameOn = !!live?.games && Object.values(live.games).some((g) => g.state === 'in');
  const isCurrentSeason = !live || live.season === leagueData.league.season;

  // Initial load, then poll while a week is live and the tab is visible
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (week === null || !isCurrentSeason) return;
    const visible = () => document.visibilityState === 'visible';
    const full = window.setInterval(() => visible() && refresh(), FULL_REFRESH_MS);
    const scores = window.setInterval(() => visible() && refreshScores(), gameOn ? SCORES_LIVE_MS : SCORES_IDLE_MS);
    // Coming back to the tab: catch up right away
    const onVisible = () => visible() && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(full);
      window.clearInterval(scores);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [week, isCurrentSeason, gameOn, refresh, refreshScores]);
  // Keeps the "updated Xs ago" label current
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const view = useMemo(() => {
    if (!live || week === null || !isCurrentSeason) return null;
    const teams = liveTeamStats(leagueData, live);
    const statuses = liveMatchupStatus(live.matchups);
    const names = new Map(teams.map((t) => [t.rosterId, t.teamName]));
    const standings = liveStandings(teams, week, playoffTeams, hasDivisions);
    const annotations = new Map<number, StandingAnnotation>(
      standings.rows.map((row) => [
        row.team.rosterId,
        {
          previousRecord: formatRecord(row.before.wins, row.before.losses, row.before.ties),
          liveResult: row.liveResult,
          playoffChange: isIn(row.before.status) === isIn(row.now.status) ? null : isIn(row.now.status) ? 'in' : 'out',
        },
      ])
    );
    // My matchup first, with me on the left (in its lineups too)
    const odds = live.projections && live.games
      ? myLiveMatchupFirst(liveWinOdds(live.matchups, live.projections, live.games, scoreSpread(teams, live.lastScoredWeek), { allowed: live.allowed, allowedScoring: live.allowedScoring }), me.rosterId)
      : null;
    return {
      odds,
      playAll: livePlayAll(teams, week),
      standings,
      annotations,
      statuses,
      names,
      started: live.matchups.some((m) => (m.points ?? 0) > 0),
    };
  }, [live, week, isCurrentSeason, leagueData, playoffTeams, hasDivisions, me.rosterId]);

  const statusBar = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
      {live && <span>Updated {secondsAgo(live.fetchedAt, now)}</span>}
      {week !== null && isCurrentSeason && <span>· {gameOn ? 'live: updates every 10 seconds' : 'updates every minute until games start'}</span>}
      <button
        type="button"
        onClick={refresh}
        disabled={loading}
        className="px-2 py-1 rounded border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--hover)] disabled:opacity-50"
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
      {error && <span className="text-[var(--danger-text)]">{error}</span>}
    </div>
  );

  if (!live) {
    return (
      <SectionCard title="Live" subtitle="This week as it happens" gradientType="info">
        <div className="px-6 py-8 space-y-3">
          <p className="text-[var(--muted)]">{error ? 'Couldn’t load live data.' : 'Loading live data…'}</p>
          {statusBar}
        </div>
      </SectionCard>
    );
  }

  if (!isCurrentSeason) {
    return (
      <SectionCard title="Live" subtitle="This week as it happens" gradientType="info">
        <p className="px-6 py-8 text-[var(--muted)]">
          The live view is for the current season ({live.season}). Switch seasons to see it.
        </p>
      </SectionCard>
    );
  }

  if (!view || week === null) {
    return (
      <SectionCard title="Live" subtitle="This week as it happens" gradientType="info">
        <div className="px-6 py-8 space-y-3">
          <p className="text-[var(--muted)]">
            No regular-season week is in progress. The live view turns on when the next week kicks off.
          </p>
          {statusBar}
        </div>
      </SectionCard>
    );
  }

  const playAllRows = sortRows(view.playAll, sort.state, (row, key) => {
    if (key === 'score') return row.score;
    if (key === 'week') return row.week.winPct;
    if (key === 'season') return row.seasonWinPct;
    const st = view.statuses.get(row.team.rosterId);
    return st && st.opponentScore !== null ? st.score - st.opponentScore : null;
  });

  return (
    <div className="space-y-8">
      <SectionCard
        title={`Week ${week} Matchups`}
        subtitle="Live scores and win odds"
        gradientType="info"
        footer={
          <span>
            Each starter still to play is expected to add his Sleeper projection for the share of his NFL game left, with a
            chance of overtime when a game is close late. Players ruled out count for nothing and doubtful ones for less.
            How much the score could still swing depends on the time left and how boom-or-bust each starter has been this
            season. Before kickoff these odds were well calibrated on the league&apos;s 2022-2025 matchups. Projected scores are the current score plus what&apos;s still expected.
          </span>
        }
      >
        <div className="px-6 pt-4">{statusBar}</div>
        {view.odds ? (
          <LiveMatchups odds={view.odds} names={view.names} avatar={(id) => teamAvatarUrl(leagueData, id)} myRosterId={me.rosterId} onOpen={setOpenMatchup} />
        ) : (
          <p className="px-6 py-4 text-sm text-[var(--muted)]">Win odds are unavailable right now (projections or the NFL scoreboard didn&apos;t load).</p>
        )}
      </SectionCard>

      <div className="space-y-3">
        <div>
          <h2 className="text-2xl font-bold text-[var(--foreground)]">Live Standings</h2>
          <p className="text-sm text-[var(--muted)]">
            If week {week} ended now: this week&apos;s real matchups decided at the current scores, laid out like the
            Overview tab. Each record shows before → now, with the dot for the real matchup right now (equal scores, including 0-0, are ties),
            and teams moving into or dropping out of a playoff spot are flagged.
          </p>
        </div>
        <PlayoffRace
          divisions={view.standings.divisions}
          wildCard={view.standings.wildCard}
          standings={view.standings.standings}
          playoffTeams={playoffTeams}
          annotations={view.annotations}
          divisionAvatars={leagueData.divisionAvatars}
        />
      </div>

      <SectionCard
        title={`Week ${week} Live Play-All`}
        subtitle="Each team's record against every other team at the current scores"
        gradientType="info"
        footer={
          <span>
            The cell is this week&apos;s play-all record at the current scores, colored by win rate. Equal scores are
            ties (including teams both still at 0) and count as half a win.
            The dot shows the real matchup right now: <span style={{ color: RESULT_DOT_COLORS.W }}>●</span> winning,{' '}
            <span style={{ color: RESULT_DOT_COLORS.L }}>●</span> losing, <span style={{ color: RESULT_DOT_COLORS.T }}>●</span> tied.
            Season play-all counts this week as if it ended now.
          </span>
        }
      >
        {!view.started && (
          <p className="px-6 pt-3 text-sm text-[var(--muted)]">No points scored yet this week, so everyone is level.</p>
        )}
        <SortStatus sort={sort} />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)]">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className={`${PIN_TH} py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]`}>Team</th>
                <SortableTh sort={sort} col="score" className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Score</SortableTh>
                <SortableTh sort={sort} col="week" tip="This week’s record against every other team at the current scores" className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">This week vs all</SortableTh>
                <SortableTh sort={sort} col="margin" label="Real matchup margin" className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Real matchup</SortableTh>
                <SortableTh sort={sort} col="season" tip="Season play-all record, counting this week as if it ended now" tipAlign="right" className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Season play-all</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {playAllRows.map((row) => {
                const s = view.statuses.get(row.team.rosterId);
                const { backgroundColor, textColor } = getHeatmapColorByRatio(row.week.winPct);
                const margin = s && s.opponentScore !== null ? s.score - s.opponentScore : null;
                return (
                  <tr key={row.team.rosterId} className={mineRow(row.team.rosterId === me.rosterId)}>
                    <td className={`${PIN_TD} py-3 whitespace-nowrap bg-[var(--surface-elevated)]`}><TeamCell team={row.team} /></td>
                    <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-semibold text-[var(--foreground)]">
                      {row.score.toFixed(2)}
                    </td>
                    <td
                      className="heat-cell px-4 py-3 whitespace-nowrap text-center text-sm font-semibold"
                      style={{ backgroundColor, color: textColor }}
                      title={`${(row.week.winPct * 100).toFixed(1)}% win rate`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <span>{formatRecord(row.week.wins, row.week.losses, row.week.ties)}</span>
                        <ResultDot result={s?.result ?? null} live />
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-[var(--muted)]">
                      {s && s.opponentRosterId !== null ? (
                        <>
                          vs {view.names.get(s.opponentRosterId) ?? `Team ${s.opponentRosterId}`}{' '}
                          {s.opponentScore?.toFixed(2)}
                          {margin !== null && (
                            <span className="ml-1 font-medium" style={{ color: RESULT_DOT_COLORS[s.result ?? 'T'] }}>
                              ({margin > 0 ? '+' : ''}{margin.toFixed(2)})
                            </span>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center text-sm text-[var(--foreground)]">
                      {formatRecord(row.seasonWins, row.seasonLosses, row.seasonTies)}
                      <span className="ml-2 text-xs text-[var(--muted)]">{(row.seasonWinPct * 100).toFixed(1)}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
      {openMatchup !== null && view.odds && live.projections && live.games && (() => {
        const m = view.odds.find((o) => o.matchupId === openMatchup);
        const { projections, games } = live;
        const defense = { allowed: live.allowed, allowedScoring: live.allowedScoring };
        const toPlayer = (p: ReturnType<typeof liveLineup>[number]): MatchupPlayer | null =>
          p && {
            ...p,
            // A finished game: his projection from before it, to compare with what he scored
            projected: p.game?.state === 'post' ? p.original : p.projected,
            status: p.game ? p.game.label : 'No game',
            live: p.game?.state === 'in',
            stats: formatStatLine(p.position, live.stats?.[p.playerId]) || undefined,
          };
        const side = (s: LiveSide, odds: number): MatchupSide | null => {
          const sm = live.matchups.find((x) => x.roster_id === s.rosterId);
          if (!sm) return null;
          return {
            name: view.names.get(s.rosterId) ?? `Team ${s.rosterId}`,
            avatarUrl: teamAvatarUrl(leagueData, s.rosterId),
            score: s.score,
            sub: (
              <>
                proj {s.projected.toFixed(1)} ·{' '}
                <span className="font-semibold" style={{ color: odds >= 0.5 ? RESULT_DOT_COLORS.W : 'var(--muted)' }}>{oddsText(odds)}</span>
              </>
            ),
            starters: liveLineup(sm, projections, games, false, defense).map(toPlayer),
            bench: liveLineup(sm, projections, games, true, defense)
              .filter((p): p is NonNullable<typeof p> => !!p)
              .map((p) => toPlayer(p)!)
              .sort((x, y) => (y.projected ?? y.points) - (x.projected ?? x.points)),
          };
        };
        const a = m && side(m.a, m.aWinOdds);
        const b = m && side(m.b, 1 - m.aWinOdds);
        return a && b ? (
          <MatchupDetail
            title={`${a.name} vs ${b.name}`}
            a={a}
            b={b}
            slots={(leagueData.league.roster_positions ?? []).filter((s) => s !== 'BN' && s !== 'IR')}
            footnote="Projected finals are points so far plus each player's projection for the share of his game left; for a finished game, his projection from before it. Bench players don't count toward the score. Injury statuses from Sleeper."
            onClose={closeMatchup}
          />
        ) : null;
      })()}
    </div>
  );
}
