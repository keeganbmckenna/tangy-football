'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TeamStats } from '@/lib/types';
import { CHART_CONFIG, CHART_THEME } from '@/lib/constants';
import { useChartHover } from '@/hooks/useChartHover';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useTeamColors } from '@/hooks/useTeamColors';
import CustomTooltip from './CustomTooltip';
import SectionCard from './ui/SectionCard';

interface StandingsOverTimeProps {
  standingsData: Record<string, number[]>;
  teams: TeamStats[];
  maxWeek?: number;
}

export default function StandingsOverTime({ standingsData, teams, maxWeek }: StandingsOverTimeProps) {
  const { setHoveredItem, clearHovered, isHovered, isOtherHovered } = useChartHover<string>();
  // Your team's line is drawn thicker
  const me = useMyTeam();
  const teamColors = useTeamColors(teams, Object.keys(standingsData));
  const [shouldAnimate, setShouldAnimate] = useState(true);
  const animationDuration = 800;

  useEffect(() => {
    setShouldAnimate(true);
  }, [standingsData, maxWeek, teams]);

  useEffect(() => {
    if (!shouldAnimate) {
      return undefined;
    }

    const timeout = setTimeout(() => setShouldAnimate(false), animationDuration);
    return () => clearTimeout(timeout);
  }, [shouldAnimate, animationDuration]);

  // Transform data for recharts - memoized for performance
  const chartData = useMemo(() => {
    const totalWeeks = teams[0]?.weeklyScores.length || 0;
    const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, totalWeeks) : totalWeeks;
    const weeks = Array.from({ length: numWeeks }, (_, i) => i + 1);

    return weeks.map((week, index) => {
      const weekData: Record<string, string | number> = { week: `W${week}` };
      Object.keys(standingsData).forEach((username) => {
        weekData[username] = standingsData[username][index];
      });
      return weekData;
    });
  }, [standingsData, teams, maxWeek]);

  return (
    <SectionCard
      title="Standings Over Time"
      subtitle="Track position changes throughout the season"
      gradientType="accent"
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
              reversed
              domain={[1, teams.length]}
              ticks={Array.from({ length: teams.length }, (_, i) => i + 1)}
              label={{ value: 'Standing', angle: -90, position: 'insideLeft', fill: CHART_THEME.tick }}
              tick={{ fill: CHART_THEME.tick }}
              axisLine={{ stroke: CHART_THEME.axis }}
              tickLine={{ stroke: CHART_THEME.axis }}
            />
            <Tooltip
              cursor={{ stroke: CHART_THEME.axis, strokeWidth: 1 }}
              content={
                <CustomTooltip
                  teams={teamColors}
                  valueFormatter={(value) => `#${value}`}
                  sortDescending={false}
                />
              }
              wrapperStyle={{ zIndex: 9999 }}
            />
            <Legend
              onMouseEnter={(e) => setHoveredItem(e.dataKey as string)}
              onMouseLeave={clearHovered}
              wrapperStyle={{ color: CHART_THEME.legend }}
            />
            {Object.keys(standingsData).map((username, index) => {
              const team = teams.find(t => t.username === username);
              const color = teamColors[index]?.color;
              const isDimmed = isOtherHovered(username);

              return (
                <Line
                  key={username}
                  type="monotone"
                  dataKey={username}
                  name={team?.teamName || username}
                  stroke={color}
                  strokeWidth={isHovered(username) || username === me.username ? CHART_CONFIG.strokeWidth.hovered : CHART_CONFIG.strokeWidth.default}
                  strokeOpacity={isDimmed ? 0 : CHART_CONFIG.opacity.default}
                  dot={{ r: isDimmed ? 0 : (isHovered(username) ? CHART_CONFIG.dotRadius.hovered : CHART_CONFIG.dotRadius.default) }}
                  activeDot={isDimmed ? false : { r: CHART_CONFIG.dotRadius.medianActive }}
                  isAnimationActive={shouldAnimate}
                  animationDuration={animationDuration}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}
