'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import PlayoffRace, { type StandingAnnotation } from '@/components/PlayoffRace';
import ResultDot from '@/components/ui/ResultDot';
import { getHeatmapColorByRatio, RESULT_DOT_COLORS } from '@/lib/constants';
import { formatRecord } from '@/lib/analyze/playEveryone';
import {
  liveMatchupStatus,
  livePlayAll,
  liveStandings,
  liveTeamStats,
  liveWeekNumber,
  type LiveWeekData,
  type PlayoffStatus,
} from '@/lib/analyze/live';
import type { LeagueData, TeamStats } from '@/lib/types';

/** How often to refresh while a week is in progress and the tab is visible */
const REFRESH_MS = 60_000;

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
  return (
    <>
      <div className="text-sm font-medium text-[var(--foreground)]">{team.teamName}</div>
      <div className="text-xs text-[var(--muted)]">@{team.username}</div>
    </>
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

  const week = live ? liveWeekNumber(live.week, live.lastScoredWeek, regularSeasonEnd) : null;
  const isCurrentSeason = !live || live.season === leagueData.league.season;

  // Initial load, then poll while a week is live and the tab is visible
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (week === null || !isCurrentSeason) return;
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const id = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [week, isCurrentSeason, refresh]);
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
    return {
      playAll: livePlayAll(teams, week),
      standings,
      annotations,
      statuses,
      names,
      started: live.matchups.some((m) => (m.points ?? 0) > 0),
    };
  }, [live, week, isCurrentSeason, leagueData, playoffTeams, hasDivisions]);

  const statusBar = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
      {live && <span>Updated {secondsAgo(live.fetchedAt, now)}</span>}
      {week !== null && isCurrentSeason && <span>· refreshes every minute</span>}
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

  return (
    <div className="space-y-8">
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
        <div className="px-6 pt-4">{statusBar}</div>
        {!view.started && (
          <p className="px-6 pt-3 text-sm text-[var(--muted)]">No points scored yet this week, so everyone is level.</p>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)]">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Team</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Score</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">This week vs all</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Real matchup</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Season play-all</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {view.playAll.map((row) => {
                const s = view.statuses.get(row.team.rosterId);
                const { backgroundColor, textColor } = getHeatmapColorByRatio(row.week.winPct);
                const margin = s && s.opponentScore !== null ? s.score - s.opponentScore : null;
                return (
                  <tr key={row.team.rosterId}>
                    <td className="px-6 py-3 whitespace-nowrap"><TeamCell team={row.team} /></td>
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
        />
      </div>
    </div>
  );
}
