'use client';

import { useMemo } from 'react';
import { TeamStats } from '@/lib/types';
import { getRankingColor, RESULT_DOT_COLORS, VIRIDIS_HEATMAP_COLORS } from '@/lib/constants';
import { formatRecord } from '@/lib/analyze/playEveryone';
import SectionCard from './ui/SectionCard';
import TeamName, { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import SortableTh, { SortStatus } from './ui/SortableTh';
import { useTableSort } from '@/hooks/useTableSort';
import { sortRows } from '@/lib/tableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';

interface WeeklyRankingsHeatmapProps {
  rankingsData: Record<string, number[]>;
  teams: TeamStats[];
  maxWeek?: number;
}

/**
 * Each team's scoring rank every week, and with it its play-all record that week (its record
 * had it played every other team) and its real result, plus season averages and play-all totals
 */
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

      // Play-all each week: wins, losses and ties against every other team's score
      const playAll = team.weeklyScores.slice(0, numWeeks).map((score, w) => {
        const others = teams.filter((t) => t.rosterId !== team.rosterId).map((t) => t.weeklyScores[w] ?? 0);
        return { wins: others.filter((o) => score > o).length, losses: others.filter((o) => score < o).length, ties: others.filter((o) => score === o).length };
      });
      const total = playAll.reduce((a, r) => ({ wins: a.wins + r.wins, losses: a.losses + r.losses, ties: a.ties + r.ties }), { wins: 0, losses: 0, ties: 0 });
      return {
        ...team,
        avgRanking: avgRanking.toFixed(2),
        medRanking,
        playAll,
        playAllTotal: total,
        playAllPct: total.wins + total.losses + total.ties ? (total.wins + total.ties / 2) / (total.wins + total.losses + total.ties) : 0,
      };
    });
  }, [teams, rankingsData, numWeeks]);

  const sort = useTableSort('weeklyRankings');
  const me = useMyTeam();
  const rows = sortRows(stats, sort.state, (team, key) =>
    key === 'avg' ? Number(team.avgRanking) : key === 'med' ? team.medRanking : key === 'playAll' ? team.playAllPct : (rankingsData[team.username] || [])[Number(key.slice(1)) - 1]
  );

  const legend = (
    <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
      <span className="font-medium">Legend:</span>
      <span>Worst</span>
      <div
        className="w-28 h-3 rounded"
        style={{ backgroundImage: `linear-gradient(90deg, ${VIRIDIS_HEATMAP_COLORS.join(', ')})` }}
      ></div>
      <span>Best</span>
      <span className="ml-2">Under each rank: that week&apos;s play-all record, and a dot for the real result</span>
    </div>
  );

  return (
    <SectionCard
      title="Weekly Ranks"
      subtitle={`Each week's scoring rank (1 = best, ${teams.length} = worst) and what it would have been against everyone`}
      gradientType="warning"
      footer={legend}
    >
      <SortStatus sort={sort} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className={`${PIN_TH} py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]`}>
                Team
              </th>
              {weeks.map((week) => (
                <SortableTh
                  key={week}
                  sort={sort}
                  col={`w${week}`}
                  best="asc"
                  label={`Week ${week} rank`}
                  className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
                >
                  W{week}
                </SortableTh>
              ))}
              <SortableTh sort={sort} col="avg" best="asc" label="Avg rank" className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]">
                Avg
              </SortableTh>
              <SortableTh sort={sort} col="med" best="asc" label="Median rank" className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]">
                Med
              </SortableTh>
              <SortableTh sort={sort} col="playAll" label="Play-all record" tip="The team's record had it played every other team every week" tipAlign="right" className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]">
                Play-all
              </SortableTh>
            </tr>
          </thead>
          <tbody className="bg-[var(--surface-elevated)] divide-y divide-[var(--border)]">
            {rows.map((team) => {
              const rankings = rankingsData[team.username] || [];
              return (
                <tr key={team.username} className={mineRow(team.rosterId === me.rosterId)}>
                  <td className={`${PIN_TD} py-3 whitespace-nowrap bg-[var(--surface-elevated)]`}>
                    <TeamName name={team.teamName} sub={`@${team.username}`} />
                  </td>
                  {rankings.slice(0, numWeeks).map((ranking, index) => {
                    const { backgroundColor, textColor } = getRankingColor(ranking, teams.length);
                    const pa = team.playAll[index];
                    const result = team.weeklyResults[index];
                    return (
                      <td
                        key={index}
                        className="heat-cell px-3 py-2 whitespace-nowrap text-center"
                        style={{ backgroundColor, color: textColor }}
                        title={`Week ${index + 1}: ranked ${ranking}, play-all ${formatRecord(pa.wins, pa.losses, pa.ties)}, ${result === 'W' ? 'won' : result === 'L' ? 'lost' : 'tied'}`}
                      >
                        <div className="text-sm font-semibold">{ranking}</div>
                        <div className="flex items-center justify-center gap-1 text-[10px] opacity-85">
                          {result && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full ring-1 ring-black/20" style={{ backgroundColor: RESULT_DOT_COLORS[result] }} />}
                          {formatRecord(pa.wins, pa.losses, pa.ties)}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 whitespace-nowrap text-center text-sm font-bold bg-[var(--surface)] text-[var(--foreground)]">
                    {team.avgRanking}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center text-sm font-bold bg-[var(--surface)] text-[var(--foreground)]">
                    {team.medRanking}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center text-sm bg-[var(--surface)] text-[var(--foreground)]">
                    <div className="font-bold">{formatRecord(team.playAllTotal.wins, team.playAllTotal.losses, team.playAllTotal.ties)}</div>
                    <div className="text-xs text-[var(--muted)]">{(team.playAllPct * 100).toFixed(1)}%</div>
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
