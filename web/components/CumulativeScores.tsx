'use client';

import { useMemo, type ReactNode } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import LazyMount from '@/components/ui/LazyMount';
import { TeamStats } from '@/lib/types';
import { CHART_CONFIG, CHART_THEME } from '@/lib/constants';
import { useChartHover } from '@/hooks/useChartHover';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { useTeamColors } from '@/hooks/useTeamColors';
import CustomTooltip from './CustomTooltip';
import SectionCard from './ui/SectionCard';

interface CumulativeScoresProps {
  cumulativeData: Record<string, number[]>;
  teams: TeamStats[];
  maxWeek?: number;
  /** Shown above the chart (a view toggle) */
  controls?: ReactNode;
}

export default function CumulativeScores({ cumulativeData, teams, maxWeek, controls }: CumulativeScoresProps) {
  const { setHoveredItem, clearHovered, isHovered, isOtherHovered } = useChartHover<string>();
  // Your team's line is drawn thicker
  const me = useMyTeam();
  const tap = useTapTooltip()();
  const teamColors = useTeamColors(teams, Object.keys(cumulativeData));

  // Transform data for recharts - memoized for performance
  const chartData = useMemo(() => {
    const totalWeeks = teams[0]?.weeklyScores.length || 0;
    const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, totalWeeks) : totalWeeks;
    const weeks = Array.from({ length: numWeeks }, (_, i) => i + 1);

    return weeks.map((week, index) => {
      const weekData: Record<string, string | number> = { week: `W${week}` };
      Object.keys(cumulativeData).forEach((username) => {
        weekData[username] = cumulativeData[username][index];
      });
      return weekData;
    });
  }, [cumulativeData, teams, maxWeek]);

  return (
    <SectionCard
      title="Cumulative Scores"
      subtitle="Total points accumulated over the season"
      gradientType="secondary"
    >
      <div className="p-6">
        {controls && <div className="mb-4">{controls}</div>}
        <LazyMount height={CHART_CONFIG.defaultHeight}>
          <ResponsiveContainer width="100%" height={CHART_CONFIG.defaultHeight}>
            <LineChart data={chartData} {...tap.chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis
                dataKey="week"
                tick={{ fill: CHART_THEME.tick }}
                axisLine={{ stroke: CHART_THEME.axis }}
                tickLine={{ stroke: CHART_THEME.axis }}
              />
              <YAxis
                label={{ value: 'Total Points', angle: -90, position: 'insideLeft', fill: CHART_THEME.tick }}
                tick={{ fill: CHART_THEME.tick }}
                axisLine={{ stroke: CHART_THEME.axis }}
                tickLine={{ stroke: CHART_THEME.axis }}
              />
              <Tooltip isAnimationActive={false}
                active={tap.active}
                cursor={{ stroke: CHART_THEME.axis, strokeWidth: 1 }}
                content={
                  <CustomTooltip
                    teams={teamColors}
                    valueFormatter={(value) => `${value.toFixed(2)} pts`}
                  />
                }
                wrapperStyle={{ zIndex: 9999 }}
              />
              <Legend
                onMouseEnter={(e) => setHoveredItem(e.dataKey as string)}
                onMouseLeave={clearHovered}
                wrapperStyle={{ color: CHART_THEME.legend }}
              />
              {Object.keys(cumulativeData).map((username, index) => {
                const team = teams.find(t => t.username === username);
                const color = teamColors[index]?.color;

                return (
                  <Line
                    isAnimationActive={false}
                    key={username}
                    type="monotone"
                    dataKey={username}
                    name={team?.teamName || username}
                    stroke={color}
                    strokeWidth={isHovered(username) || username === me.username ? CHART_CONFIG.strokeWidth.hovered : CHART_CONFIG.strokeWidth.default}
                    strokeOpacity={isOtherHovered(username) ? CHART_CONFIG.opacity.dimmed : CHART_CONFIG.opacity.default}
                    dot={{ r: isHovered(username) ? CHART_CONFIG.dotRadius.hovered : CHART_CONFIG.dotRadius.default }}
                    activeDot={{ r: CHART_CONFIG.dotRadius.active }}
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
