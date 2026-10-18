'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import LazyMount from '@/components/ui/LazyMount';
import SectionCard from '@/components/ui/SectionCard';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import { useTableSort } from '@/hooks/useTableSort';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { CHART_THEME } from '@/lib/constants';
import { recordValue, sortRows } from '@/lib/tableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { formatRecord } from '@/lib/analyze/playEveryone';
import type { PlayEveryoneStats } from '@/lib/types';

// Same pairing as the schedule luck chart: amber is what really happened
const ACTUAL_COLOR = '#f59e0b';
const PLAY_ALL_COLOR = '#3b82f6';

interface PlayEveryoneAnalysisProps {
  data: PlayEveryoneStats[];
}

interface BarChartTooltipProps {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
    payload: {
      name: string;
    };
  }>;
}

function BarChartTooltip({ active, payload }: BarChartTooltipProps) {
  if (!active || !payload || !payload.length) {
    return null;
  }

  return (
    <div className="bg-[var(--chart-tooltip-bg)] border-2 border-[var(--chart-tooltip-border)] rounded-lg shadow-lg p-3">
      <p className="font-bold text-[var(--chart-tooltip-text)] mb-2">{payload[0].payload.name}</p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-sm text-[var(--chart-tooltip-muted)]">
              {entry.dataKey}: <span className="font-semibold">{entry.value}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlayEveryoneAnalysis({ data }: PlayEveryoneAnalysisProps) {
  // Sort by expected wins (play-all results, ties as half a win)
  const sortedData = [...data].sort((a, b) => b.expectedWins - a.expectedWins);
  // Rank stays the play-all rank whichever way the table is sorted
  const sort = useTableSort('playEveryone');
  const me = useMyTeam();
  const tap = useTapTooltip()();
  const rows = sortRows(
    sortedData.map((team, i) => ({ team, rank: i + 1 })),
    sort.state,
    ({ team }, key) =>
      ({
        playAll: recordValue(team.playAllWins, team.playAllLosses, team.playAllTies),
        real: recordValue(team.actualWins, team.actualLosses, team.actualTies),
        expected: team.expectedWins,
        luck: team.difference,
      })[key]
  );

  // Transform for bar chart
  const chartData = sortedData.map(team => ({
    name: team.teamName,
    'Actual Wins': team.actualWins,
    'Play-All Wins': Math.round(team.expectedWins), // Normalized to equivalent weekly wins
  }));

  return (
    <SectionCard
      title="Play Everyone Analysis"
      subtitle="What if each team played all other teams every week? Shows luck vs skill."
      gradientType="info"
      footer={
        <p className="text-xs text-[var(--muted)]">
          <strong>How to read:</strong> Play-All Wins shows total wins if each team played all
          other teams every week. Expected Wins = play-all results divided by the number of
          opponents, and Luck Factor = Actual Wins - Expected Wins. Ties count as half a win.
          Positive = lucky matchups, Negative = unlucky matchups.
        </p>
      }
    >
      {/* Chart */}
      <div className="p-6 border-b border-[var(--border)]">
        <LazyMount height={400}>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData} {...tap.chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                height={120}
                interval={0}
                tick={{ fill: CHART_THEME.tick }}
                axisLine={{ stroke: CHART_THEME.axis }}
                tickLine={{ stroke: CHART_THEME.axis }}
                style={{ fontSize: '12px' }}
              />
              <YAxis
                label={{ value: 'Wins', angle: -90, position: 'insideLeft', fill: CHART_THEME.tick }}
                tick={{ fill: CHART_THEME.tick }}
                axisLine={{ stroke: CHART_THEME.axis }}
                tickLine={{ stroke: CHART_THEME.axis }}
              />
              <Tooltip active={tap.active} content={<BarChartTooltip />} cursor={{ fill: CHART_THEME.cursor }} />
              <Legend formatter={(value) => <span style={{ color: CHART_THEME.legend }}>{value}</span>} />
              <Bar isAnimationActive={false} dataKey="Actual Wins" fill={ACTUAL_COLOR} radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar isAnimationActive={false} dataKey="Play-All Wins" fill={PLAY_ALL_COLOR} radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </LazyMount>
      </div>

      {/* Table */}
      <SortStatus sort={sort} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Rank
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Team
              </th>
              <SortableTh sort={sort} col="playAll" tip="The team’s record if it had played every other team every week" className="px-6 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Play-All Record
              </SortableTh>
              <SortableTh sort={sort} col="real" className="px-6 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Real Record
              </SortableTh>
              <SortableTh sort={sort} col="expected" tip="The play-all win rate times games played: the wins a typical schedule would have given" className="px-6 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Expected Wins
              </SortableTh>
              <SortableTh sort={sort} col="luck" tip="Real wins minus expected wins: positive means the schedule helped (lucky), negative means it hurt" tipAlign="right" className="px-6 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                Luck Factor
              </SortableTh>
            </tr>
          </thead>
          <tbody className="bg-[var(--surface-elevated)] divide-y divide-[var(--border)]">
            {rows.map(({ team, rank }) => {
              const isLucky = team.difference >= 1;
              const isUnlucky = team.difference <= -1;


              return (
                <tr key={team.username} className={mineRow(team.username === me.username)}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-[var(--foreground)]">
                    {rank}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-[var(--foreground)]">
                      {team.teamName}
                    </div>
                    <div className="text-sm text-[var(--muted)]">@{team.username}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-[var(--foreground)]">
                    {formatRecord(team.playAllWins, team.playAllLosses, team.playAllTies)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-[var(--foreground)]">
                    {formatRecord(team.actualWins, team.actualLosses, team.actualTies)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-[var(--muted)]">
                    {team.expectedWins.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        isLucky
                          ? 'bg-[var(--success-bg)] text-[var(--success-text)]'
                          : isUnlucky
                          ? 'bg-[var(--danger-bg)] text-[var(--danger-text)]'
                          : 'bg-[var(--neutral-bg)] text-[var(--neutral-text)]'
                      }`}
                    >
                      {team.difference > 0 ? '+' : ''}
                      {team.difference.toFixed(2)}
                      {isLucky ? ' Lucky' : isUnlucky ? ' Unlucky' : ' Neutral'}
                    </span>
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
