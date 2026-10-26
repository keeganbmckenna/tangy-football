'use client';

import { useMemo } from 'react';
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import LazyMount from '@/components/ui/LazyMount';
import SectionCard from '@/components/ui/SectionCard';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import TeamName, { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import { useTableSort } from '@/hooks/useTableSort';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { CHART_THEME, RESULT_DOT_COLORS } from '@/lib/constants';
import { recordValue, sortRows } from '@/lib/tableSort';
import { formatRecord } from '@/lib/analyze/playEveryone';
import { CLOSE_GAME_MARGIN, luckBreakdown } from '@/lib/analyze/luck';
import type { PlayEveryoneStats, TeamStats, WeekMatchup } from '@/lib/types';
import { asShown, signed } from '@/lib/format';

interface LuckBreakdownProps {
  teams: TeamStats[];
  playEveryone: PlayEveryoneStats[];
  matchups: Record<number, WeekMatchup[]>;
  maxWeek: number;
}

function LuckTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; luck: number; close: string } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border-2 border-[var(--chart-tooltip-border)] bg-[var(--chart-tooltip-bg)] p-3 shadow-lg">
      <p className="mb-1 font-bold text-[var(--chart-tooltip-text)]">{d.name}</p>
      <p className="text-sm font-semibold text-[var(--chart-tooltip-text)]">Luck: {signed(d.luck)} wins</p>
      <p className="text-sm text-[var(--chart-tooltip-muted)]">Close games: {d.close}</p>
    </div>
  );
}

/**
 * Luck: each team's real wins against the wins its scoring deserved (from play-all), and its
 * record in close games (lib/analyze/luck.ts)
 */
export default function LuckBreakdown({ teams, playEveryone, matchups, maxWeek }: LuckBreakdownProps) {
  const sort = useTableSort('luckBreakdown');
  const me = useMyTeam();
  const tap = useTapTooltip()();
  const data = useMemo(() => luckBreakdown(teams, playEveryone, matchups, maxWeek), [teams, playEveryone, matchups, maxWeek]);
  const byTotal = [...data].sort((a, b) => b.total - a.total);
  const rows = sortRows(byTotal, sort.state, (t, key) =>
    ({
      record: recordValue(t.wins, t.losses, t.ties),
      playAll: recordValue(t.playAll.wins, t.playAll.losses, t.playAll.ties),
      expected: t.expectedWins,
      total: t.total,
      close: recordValue(t.close.wins, t.close.losses, t.close.ties),
    })[key]
  );
  const chartData = byTotal.map((t) => ({
    name: t.teamName,
    // Exact (rounded once, for display, like the table: rounding twice turned -0.545 into -0.6)
    luck: t.total,
    close: formatRecord(t.close.wins, t.close.losses, t.close.ties),
  }));
  const th = 'px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--muted)] sm:px-4';
  const td = 'px-3 py-3 whitespace-nowrap text-center text-sm tabular-nums sm:px-4';
  // Colored by the number shown, so "+0.5" is always green
  const tone = (v: number) => {
    const shown = asShown(v);
    return shown >= 0.5 ? 'text-[var(--success-text)]' : shown <= -0.5 ? 'text-[var(--danger-text)]' : 'text-[var(--foreground)]';
  };

  return (
    <SectionCard
      title="Luck"
      subtitle="Real wins against the wins each team's scoring deserved"
      gradientType="warning"
      footer={
        <span>
          <strong>Expected</strong> is the wins a team&apos;s scoring deserved: its play-all record (as if it played every team
          every week) turned into a win rate over its real games. <strong>Luck</strong> is real wins minus expected: plus means
          it won more than its scoring deserved, minus fewer. <strong>Close</strong> is its record in games decided by under{' '}
          {CLOSE_GAME_MARGIN} points.
        </span>
      }
    >
      <div className="border-b border-[var(--border)] p-4 sm:p-6">
        <LazyMount height={44 + chartData.length * 30}>
          <ResponsiveContainer width="100%" height={44 + chartData.length * 30}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 8 }} {...tap.chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: CHART_THEME.tick, fontSize: 12 }} axisLine={{ stroke: CHART_THEME.axis }} tickLine={{ stroke: CHART_THEME.axis }} />
              <YAxis
                type="category"
                dataKey="name"
                width={96}
                interval={0}
                tick={{ fill: CHART_THEME.tick, fontSize: 11 }}
                tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)}
                axisLine={{ stroke: CHART_THEME.axis }}
                tickLine={false}
              />
              <ReferenceLine x={0} stroke={CHART_THEME.axis} />
              <Tooltip active={tap.active} content={<LuckTooltip />} cursor={{ fill: CHART_THEME.cursor }} />
              <Bar isAnimationActive={false} dataKey="luck" name="Luck" maxBarSize={18}>
                {chartData.map((d) => (
                  <Cell key={d.name} fill={d.luck >= 0 ? RESULT_DOT_COLORS.W : RESULT_DOT_COLORS.L} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </LazyMount>
      </div>
      <SortStatus sort={sort} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className={`${PIN_TH} py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] bg-[var(--surface)]`}>Team</th>
              <SortableTh sort={sort} col="record" className={th}>Record</SortableTh>
              <SortableTh sort={sort} col="playAll" tip="Its record had it played every other team every week" className={th}>Play-all</SortableTh>
              <SortableTh sort={sort} col="expected" tip="Wins the team's scoring deserved: its play-all win rate times games played" className={th}>Expected</SortableTh>
              <SortableTh sort={sort} col="total" tip="Real wins minus expected wins" className={th}>Luck</SortableTh>
              <SortableTh sort={sort} col="close" tip={`Record in games decided by under ${CLOSE_GAME_MARGIN} points`} tipAlign="right" className={th}>Close</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface-elevated)]">
            {rows.map((t) => (
              <tr key={t.rosterId} className={mineRow(t.rosterId === me.rosterId)}>
                <td className={`${PIN_TD} py-3 whitespace-nowrap bg-[var(--surface-elevated)]`}>
                  <TeamName name={t.teamName} sub={`@${t.username}`} />
                </td>
                <td className={`${td} text-[var(--foreground)]`}>{formatRecord(t.wins, t.losses, t.ties)}</td>
                <td className={`${td} text-[var(--muted)]`}>{formatRecord(t.playAll.wins, t.playAll.losses, t.playAll.ties)}</td>
                <td className={`${td} text-[var(--muted)]`}>{t.expectedWins.toFixed(1)}</td>
                <td className={`${td} font-semibold ${tone(t.total)}`}>{signed(t.total)}</td>
                <td className={`${td} text-[var(--foreground)]`}>{formatRecord(t.close.wins, t.close.losses, t.close.ties)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
