'use client';

import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import LazyMount from '@/components/ui/LazyMount';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RetryButton from '@/components/ui/RetryButton';
import SectionCard from '@/components/ui/SectionCard';
import { CHART_CONFIG, CHART_THEME } from '@/lib/constants';
import { useChartHover } from '@/hooks/useChartHover';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useOddsHistory } from '@/hooks/useOddsData';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { useTeamColors } from '@/hooks/useTeamColors';
import type { OddsResult } from '@/lib/analyze/playoffOdds';
import type { OddsSnapshot } from '@/lib/oddsHistory';
import type { TeamStats } from '@/lib/types';
import CustomTooltip from './CustomTooltip';

interface OddsHistoryChartProps {
  season: string;
  /** The season's team stats, for names, colors and divisions */
  teamStats: TeamStats[];
  /** The Playoffs tab's live odds, used for the latest point so the chart ends where the table does */
  liveOdds?: OddsResult | null;
  /** Weeks scored, to know which checkpoint the live odds replace */
  lastScoredWeek?: number;
  /** A finished season: load the pre-built file (web/public/data/odds-history/) first */
  complete?: boolean;
}

type Outcome = keyof OddsSnapshot;

/**
 * Week-by-week odds: each team's chance of the chosen outcome as of the draft and after every
 * completed week, the playoff-odds model re-run with only what was known then
 * (/api/odds-history/{season}, lib/oddsHistory.ts).
 */
export default function OddsHistoryChart({ season, teamStats, liveOdds, lastScoredWeek, complete = false }: OddsHistoryChartProps) {
  const [outcome, setOutcome] = useState<Outcome>('playoffs');
  const { setHoveredItem, clearHovered, isHovered, isOtherHovered } = useChartHover<string>();
  const me = useMyTeam();
  const tap = useTapTooltip()();

  const { data, error, retry } = useOddsHistory(season, complete);

  const usernames = useMemo(() => teamStats.map((t) => t.username), [teamStats]);
  const teamColors = useTeamColors(teamStats, usernames);

  const options = useMemo(() => {
    const hasTitle = !!data?.checkpoints.some((c) => Object.values(c.odds).some((o) => o.champion !== null));
    const hasToilet = !!data?.hasToiletBowl && !!data?.checkpoints.some((c) => Object.values(c.odds).some((o) => o.lastPlace !== null));
    return [
      { key: 'playoffs' as const, label: 'Make the playoffs' },
      { key: 'bye' as const, label: 'Playoff bye' },
      ...(data?.hasDivisions ? [{ key: 'division' as const, label: 'Win the division' }] : []),
      ...(hasTitle ? [{ key: 'champion' as const, label: 'Win the league' }] : []),
      ...(hasToilet ? [{ key: 'toiletBye' as const, label: 'Toilet bowl bye' }] : []),
      ...(hasToilet ? [{ key: 'lastPlace' as const, label: 'Lose the toilet bowl' }] : []),
    ];
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    const byRoster = new Map(teamStats.map((t) => [t.rosterId, t.username]));
    return data.checkpoints.map((c) => {
      // The latest point is the Playoffs tab's own odds (they also count this week's injuries)
      const live = liveOdds && c.week === lastScoredWeek ? liveOdds.teams : null;
      const row: Record<string, string | number> = { week: c.week === 0 ? 'Draft' : `W${c.week}` };
      for (const [rid, o] of Object.entries(c.odds)) {
        const username = byRoster.get(Number(rid));
        if (!username) continue;
        const value = live?.[Number(rid)]?.[outcome] ?? o[outcome];
        if (value !== null && value !== undefined) row[username] = Math.round(value * 1000) / 10;
      }
      return row;
    });
  }, [data, teamStats, outcome, liveOdds, lastScoredWeek]);

  const title = 'Odds Week by Week';
  if (error) {
    return (
      <SectionCard title={title} gradientType="info">
        <div className="px-6 py-8">
          <p className="text-[var(--muted)]">Couldn&apos;t load the odds history: {error}</p>
          <RetryButton onClick={retry} />
        </div>
      </SectionCard>
    );
  }
  if (!data) return <LoadingSpinner message="Replaying the season's odds..." />;
  if (data.checkpoints.length < 2) return null;
  const selected = options.some((o) => o.key === outcome) ? outcome : 'playoffs';

  return (
    <SectionCard
      title={title}
      subtitle={data.complete ? 'How each team’s odds moved through the season' : 'How each team’s odds have moved so far'}
      gradientType="info"
      footer={
        <span>
          Each point is the playoff-odds model re-run with only what was known then: rosters (the drafted ones, then each
          week&apos;s), records and points so far, and the projections published that week, carried forward with bye weeks.
          The Draft point has no games played, and the model&apos;s weights were fitted from week 3 on, so the first points
          are rougher. Earlier points don&apos;t discount injured players, since past injury reports aren&apos;t kept
          {liveOdds ? '; the latest point is the live odds above' : ''}.
        </span>
      }
    >
      <label className="flex flex-wrap items-center gap-2 px-6 pt-4 text-sm text-[var(--foreground)]">
        Chance to
        <select
          value={selected}
          onChange={(e) => setOutcome(e.target.value as Outcome)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          {options.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label.toLowerCase()}</option>
          ))}
        </select>
      </label>
      <div className="p-6">
        <LazyMount height={CHART_CONFIG.defaultHeight}>
          <ResponsiveContainer width="100%" height={CHART_CONFIG.defaultHeight}>
            <LineChart data={chartData} {...tap.chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="week" tick={{ fill: CHART_THEME.tick }} axisLine={{ stroke: CHART_THEME.axis }} tickLine={{ stroke: CHART_THEME.axis }} />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fill: CHART_THEME.tick }}
                axisLine={{ stroke: CHART_THEME.axis }}
                tickLine={{ stroke: CHART_THEME.axis }}
              />
              <Tooltip isAnimationActive={false}
                active={tap.active}
                cursor={{ stroke: CHART_THEME.axis, strokeWidth: 1 }}
                content={<CustomTooltip teams={teamColors} valueFormatter={(value) => `${value.toFixed(1)}%`} />}
                wrapperStyle={{ zIndex: 9999 }}
              />
              <Legend onMouseEnter={(e) => setHoveredItem(e.dataKey as string)} onMouseLeave={clearHovered} wrapperStyle={{ color: CHART_THEME.legend }} />
              {teamColors.map(({ username, teamName, color }) => (
                <Line
                  isAnimationActive={false}
                  key={username}
                  type="monotone"
                  dataKey={username}
                  name={teamName || username}
                  stroke={color}
                  connectNulls
                  strokeWidth={isHovered(username) || username === me.username ? CHART_CONFIG.strokeWidth.hovered : CHART_CONFIG.strokeWidth.default}
                  strokeOpacity={isOtherHovered(username) ? CHART_CONFIG.opacity.dimmed : CHART_CONFIG.opacity.default}
                  dot={{ r: isHovered(username) ? CHART_CONFIG.dotRadius.hovered : CHART_CONFIG.dotRadius.default }}
                  activeDot={{ r: CHART_CONFIG.dotRadius.active }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </LazyMount>
      </div>
    </SectionCard>
  );
}
