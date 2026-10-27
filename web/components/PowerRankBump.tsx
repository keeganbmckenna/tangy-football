'use client';

import { useMemo, type ReactNode } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import LazyMount from '@/components/ui/LazyMount';
import SectionCard from '@/components/ui/SectionCard';
import { CHART_CONFIG, CHART_THEME } from '@/lib/constants';
import { useChartHover } from '@/hooks/useChartHover';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useOddsHistory } from '@/hooks/useOddsData';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { useTeamColors } from '@/hooks/useTeamColors';
import type { TeamStats } from '@/lib/types';
import CustomTooltip from './CustomTooltip';

interface PowerRankBumpProps {
  season: string;
  teamStats: TeamStats[];
  /** A finished season: its odds history is pre-built */
  complete: boolean;
  /** Shown above the chart (a view toggle) */
  controls?: ReactNode;
}

/**
 * Power rankings week by week: each team's rank by the playoff-odds model's expected weekly
 * score as of the draft and after every week (the odds history's checkpoints)
 */
export default function PowerRankBump({ season, teamStats, complete, controls }: PowerRankBumpProps) {
  const { data } = useOddsHistory(season, complete);
  const { setHoveredItem, clearHovered, isHovered, isOtherHovered } = useChartHover<string>();
  const me = useMyTeam();
  const tap = useTapTooltip()();
  const usernames = useMemo(() => teamStats.map((t) => t.username), [teamStats]);
  const teamColors = useTeamColors(teamStats, usernames);

  const chartData = useMemo(() => {
    const byRoster = new Map(teamStats.map((t) => [t.rosterId, t.username]));
    return (data?.checkpoints ?? [])
      .filter((c) => c.strength)
      .map((c) => {
        const row: Record<string, string | number> = { week: c.week === 0 ? 'Draft' : `W${c.week}` };
        Object.entries(c.strength!)
          .sort(([, a], [, b]) => b - a)
          .forEach(([rid], i) => {
            const username = byRoster.get(Number(rid));
            if (username) row[username] = i + 1;
          });
        return row;
      });
  }, [data, teamStats]);
  if (chartData.length < 2) return null;

  return (
    <SectionCard
      title="Power Rankings Over Time"
      subtitle="Each team's rank by the playoff-odds model, from the draft on"
      gradientType="primary"
      footer={
        <span>
          Each point ranks the teams by their expected weekly score as the model saw it then: projected lineups (the drafted
          rosters at the Draft point) and points per game so far, weighted as fitted on thousands of other leagues. It moves
          with roster changes and results, so it often leads the standings.
        </span>
      }
    >
      <div className="p-4 sm:p-6">
        {controls && <div className="mb-4">{controls}</div>}
        <LazyMount height={CHART_CONFIG.defaultHeight}>
          <ResponsiveContainer width="100%" height={CHART_CONFIG.defaultHeight}>
            <LineChart data={chartData} {...tap.chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="week" tick={{ fill: CHART_THEME.tick }} axisLine={{ stroke: CHART_THEME.axis }} tickLine={{ stroke: CHART_THEME.axis }} />
              <YAxis
                reversed
                domain={[1, teamStats.length]}
                ticks={Array.from({ length: teamStats.length }, (_, i) => i + 1)}
                width={28}
                tick={{ fill: CHART_THEME.tick }}
                axisLine={{ stroke: CHART_THEME.axis }}
                tickLine={{ stroke: CHART_THEME.axis }}
              />
              <Tooltip isAnimationActive={false}
                active={tap.active}
                cursor={{ stroke: CHART_THEME.axis, strokeWidth: 1 }}
                content={<CustomTooltip teams={teamColors} valueFormatter={(value) => `#${value}`} sortDescending={false} />}
                wrapperStyle={{ zIndex: 9999 }}
              />
              <Legend onMouseEnter={(e) => setHoveredItem(e.dataKey as string)} onMouseLeave={clearHovered} wrapperStyle={{ color: CHART_THEME.legend }} />
              {teamColors.map(({ username, teamName, color }) => {
                const dimmed = isOtherHovered(username);
                return (
                  <Line
                    isAnimationActive={false}
                    key={username}
                    type="monotone"
                    dataKey={username}
                    name={teamName || username}
                    stroke={color}
                    strokeWidth={isHovered(username) || username === me.username ? CHART_CONFIG.strokeWidth.hovered : CHART_CONFIG.strokeWidth.default}
                    strokeOpacity={dimmed ? CHART_CONFIG.opacity.dimmed : CHART_CONFIG.opacity.default}
                    dot={{ r: dimmed ? 0 : isHovered(username) ? CHART_CONFIG.dotRadius.hovered : CHART_CONFIG.dotRadius.default }}
                    activeDot={dimmed ? false : { r: CHART_CONFIG.dotRadius.active }}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </LazyMount>
      </div>
    </SectionCard>
  );
}
