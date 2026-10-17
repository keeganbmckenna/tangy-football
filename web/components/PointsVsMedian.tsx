'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TeamStats } from '@/lib/types';
import { CHART_CONFIG, CHART_THEME } from '@/lib/constants';
import { useChartHover } from '@/hooks/useChartHover';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useTeamColors } from '@/hooks/useTeamColors';
import CustomTooltip from './CustomTooltip';
import SectionCard from './ui/SectionCard';

interface PointsVsMedianProps {
  differenceData: Record<string, number[]>;
  teams: TeamStats[];
  maxWeek?: number;
}

const MEDIAN_COLOR = CHART_THEME.median;

export default function PointsVsMedian({ differenceData, teams, maxWeek }: PointsVsMedianProps) {
  const { setHoveredItem, clearHovered, isHovered, isOtherHovered } = useChartHover<string>();
  // Your team's line is drawn thicker
  const me = useMyTeam();
  const teamColors = useTeamColors(teams, Object.keys(differenceData));

  // Transform data for recharts - memoized for performance
  const chartData = useMemo(() => {
    const totalWeeks = teams[0]?.weeklyScores.length || 0;
    const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, totalWeeks) : totalWeeks;
    const weeks = Array.from({ length: numWeeks }, (_, i) => i + 1);

    return weeks.map((week, index) => {
      const weekData: Record<string, string | number> = {
        week: `W${week}`,
        median: 0, // Median is always 0 in difference view
      };
      Object.keys(differenceData).forEach((username) => {
        weekData[username] = differenceData[username][index];
      });
      return weekData;
    });
  }, [differenceData, teams, maxWeek]);

  // Prepare team data with colors for tooltip (including median)
  const teamColorsWithMedian = useMemo(
    () => [
      { username: 'median', teamName: 'Median', color: MEDIAN_COLOR },
      ...teamColors,
    ],
    [teamColors]
  );

  return (
    <SectionCard
      title="Difference from Median"
      subtitle="Cumulative points above or below median (positive = above, negative = below)"
      gradientType="success"
    >
      <div className="p-6">
        <ResponsiveContainer width="100%" height={CHART_CONFIG.defaultHeight}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
            <XAxis
              dataKey="week"
              tick={{ fill: CHART_THEME.tick }}
              axisLine={{ stroke: CHART_THEME.axis }}
              tickLine={{ stroke: CHART_THEME.axis }}
            />
            <YAxis
              label={{ value: 'Points Above/Below Median', angle: -90, position: 'insideLeft', fill: CHART_THEME.tick }}
              tick={{ fill: CHART_THEME.tick }}
              axisLine={{ stroke: CHART_THEME.axis }}
              tickLine={{ stroke: CHART_THEME.axis }}
            />
            <Tooltip
              cursor={{ stroke: CHART_THEME.axis, strokeWidth: 1 }}
              content={
                <CustomTooltip
                  teams={teamColorsWithMedian}
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
            {/* Median line - bold and always visible */}
            <Line
              type="monotone"
              dataKey="median"
              name="Median"
              stroke={MEDIAN_COLOR}
              strokeWidth={isHovered('median') ? CHART_CONFIG.strokeWidth.medianHovered : CHART_CONFIG.strokeWidth.median}
              strokeOpacity={isOtherHovered('median') ? CHART_CONFIG.opacity.median : CHART_CONFIG.opacity.default}
              strokeDasharray="5 5"
              dot={false}
              activeDot={{ r: CHART_CONFIG.dotRadius.medianActive }}
            />
            {/* Team lines */}
            {Object.keys(differenceData).map((username, index) => {
              const team = teams.find((t) => t.username === username);
              const color = teamColors[index]?.color;

              return (
                <Line
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
      </div>
    </SectionCard>
  );
}
