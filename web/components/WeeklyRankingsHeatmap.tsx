'use client';

import { useMemo } from 'react';
import { TeamStats } from '@/lib/types';
import { getRankingColor, VIRIDIS_HEATMAP_COLORS } from '@/lib/constants';
import SectionCard from './ui/SectionCard';

interface WeeklyRankingsHeatmapProps {
  rankingsData: Record<string, number[]>;
  teams: TeamStats[];
  maxWeek?: number;
}

export default function WeeklyRankingsHeatmap({ rankingsData, teams, maxWeek }: WeeklyRankingsHeatmapProps) {
  const totalWeeks = teams[0]?.weeklyScores.length || 0;
  const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, totalWeeks) : totalWeeks;
  const weeks = Array.from({ length: numWeeks }, (_, i) => i + 1);

  // Calculate stats - memoized for performance
  const stats = useMemo(() => {
    const sortedTeams = [...teams].sort((a, b) => a.standing - b.standing);

    return sortedTeams.map((team) => {
      const rankings = (rankingsData[team.username] || []).slice(0, numWeeks);
      const avgRanking = rankings.length > 0 ? rankings.reduce((a, b) => a + b, 0) / rankings.length : 0;
      const sortedRankings = [...rankings].sort((a, b) => a - b);
      const medRanking = sortedRankings[Math.floor(sortedRankings.length / 2)];

      return {
        ...team,
        avgRanking: avgRanking.toFixed(2),
        medRanking,
      };
    });
  }, [teams, rankingsData, numWeeks]);

  const legend = (
    <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
      <span className="font-medium">Legend:</span>
      <span>Worst</span>
      <div
        className="w-28 h-3 rounded"
        style={{ backgroundImage: `linear-gradient(90deg, ${VIRIDIS_HEATMAP_COLORS.join(', ')})` }}
      ></div>
      <span>Best</span>
    </div>
  );

  return (
    <SectionCard
      title="Weekly Rankings Heatmap"
      subtitle={`Performance ranking each week (1=best, ${teams.length}=worst)`}
      gradientType="warning"
      footer={legend}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider sticky left-0 bg-[var(--surface)] z-10">
                Team
              </th>
              {weeks.map((week) => (
                <th
                  key={week}
                  className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
                >
                  W{week}
                </th>
              ))}
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]">
                Avg
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]">
                Med
              </th>
            </tr>
          </thead>
          <tbody className="bg-[var(--surface-elevated)] divide-y divide-[var(--border)]">
            {stats.map((team) => {
              const rankings = rankingsData[team.username] || [];
              return (
                <tr key={team.username}>
                  <td className="px-6 py-3 whitespace-nowrap sticky left-0 bg-[var(--surface-elevated)] z-10 border-r border-[var(--border)]">
                    <div className="text-sm font-medium text-[var(--foreground)]">{team.teamName}</div>
                    <div className="text-xs text-[var(--muted)]">@{team.username}</div>
                  </td>
                  {rankings.slice(0, numWeeks).map((ranking, index) => {
                    const { backgroundColor, textColor } = getRankingColor(ranking, teams.length);
                    return (
                      <td
                        key={index}
                        className="heat-cell px-3 py-3 whitespace-nowrap text-center text-sm font-semibold"
                        style={{ backgroundColor, color: textColor }}
                      >
                        {ranking}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 whitespace-nowrap text-center text-sm font-bold bg-[var(--surface)] text-[var(--foreground)]">
                    {team.avgRanking}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center text-sm font-bold bg-[var(--surface)] text-[var(--foreground)]">
                    {team.medRanking}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
