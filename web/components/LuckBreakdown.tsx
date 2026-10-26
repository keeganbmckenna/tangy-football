'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import LazyMount from '@/components/ui/LazyMount';
import SectionCard from '@/components/ui/SectionCard';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import TeamName, { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import { useTableSort } from '@/hooks/useTableSort';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { CHART_THEME } from '@/lib/constants';
import { recordValue, sortRows } from '@/lib/tableSort';
import { formatRecord } from '@/lib/analyze/playEveryone';
import { CLOSE_GAME_MARGIN, luckBreakdown } from '@/lib/analyze/luck';
import type { PlayEveryoneStats, TeamStats, WeekMatchup } from '@/lib/types';

const SCHEDULE_COLOR = '#8b5cf6';
const OPPONENTS_COLOR = '#f59e0b';

interface LuckBreakdownProps {
  teams: TeamStats[];
  playEveryone: PlayEveryoneStats[];
  matchups: Record<number, WeekMatchup[]>;
  maxWeek: number;
}

const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

function LuckTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; schedule: number; opponents: number; total: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border-2 border-[var(--chart-tooltip-border)] bg-[var(--chart-tooltip-bg)] p-3 shadow-lg">
      <p className="mb-1 font-bold text-[var(--chart-tooltip-text)]">{d.name}</p>
      <p className="text-sm text-[var(--chart-tooltip-muted)]">Schedule: {signed(d.schedule)} wins</p>
      <p className="text-sm text-[var(--chart-tooltip-muted)]">Opponents&apos; days: {signed(d.opponents)} wins</p>
      <p className="text-sm font-semibold text-[var(--chart-tooltip-text)]">Total luck: {signed(d.total)} wins</p>
    </div>
  );
}

/**
 * Why each record is what it is: real wins against what the scoring deserved (play-all),
 * with the difference split into schedule luck and opponents' off or career days, plus the
 * close-game record (lib/analyze/luck.ts)
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
      expected: t.expectedWins,
      schedule: t.schedule,
      opponents: t.opponentsDays,
      total: t.total,
      close: recordValue(t.close.wins, t.close.losses, t.close.ties),
    })[key]
  );
  const chartData = byTotal.map((t) => ({
    name: t.teamName,
    schedule: Math.round(t.schedule * 100) / 100,
    opponents: Math.round(t.opponentsDays * 100) / 100,
    total: t.total,
  }));
  const th = 'px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--muted)] sm:px-4';
  const td = 'px-3 py-3 whitespace-nowrap text-center text-sm tabular-nums sm:px-4';
  const tone = (v: number) => (v >= 0.5 ? 'text-[var(--success-text)]' : v <= -0.5 ? 'text-[var(--danger-text)]' : 'text-[var(--foreground)]');

  return (
    <SectionCard
      title="Luck Breakdown"
      subtitle="Real wins against the wins each team's scoring deserved, and where the difference came from"
      gradientType="warning"
      footer={
        <span>
          Expected wins are the play-all expectation above. <strong>Schedule</strong> is the wins a team would have had if
          every opponent had scored its own season average, minus that expectation: drawing weak or strong opponents.{' '}
          <strong>Opponents&apos; days</strong> is real wins minus those: opponents having off days (or career days) against
          you. The two add up to the luck factor. Close games were decided by under {CLOSE_GAME_MARGIN} points.
        </span>
      }
    >
      <div className="border-b border-[var(--border)] p-4 sm:p-6">
        <LazyMount height={44 + chartData.length * 30}>
          <ResponsiveContainer width="100%" height={44 + chartData.length * 30}>
            <BarChart data={chartData} layout="vertical" stackOffset="sign" margin={{ left: 0, right: 8 }} {...tap.chartProps}>
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
              <Legend formatter={(value) => <span style={{ color: CHART_THEME.legend }}>{value}</span>} />
              <Bar isAnimationActive={false} dataKey="schedule" name="Schedule" stackId="luck" fill={SCHEDULE_COLOR} maxBarSize={18} />
              <Bar isAnimationActive={false} dataKey="opponents" name="Opponents' days" stackId="luck" fill={OPPONENTS_COLOR} maxBarSize={18} />
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
              <SortableTh sort={sort} col="expected" tip="Wins the team's scoring deserved: its play-all win rate times games played" className={th}>Expected</SortableTh>
              <SortableTh sort={sort} col="schedule" tip="Wins from who it drew: with every opponent at its season average, minus expected" className={th}>Schedule</SortableTh>
              <SortableTh sort={sort} col="opponents" tip="Wins from opponents' off or career days against it" className={th}>Opp. days</SortableTh>
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
                <td className={`${td} text-[var(--muted)]`}>{t.expectedWins.toFixed(1)}</td>
                <td className={`${td} ${tone(t.schedule)}`}>{signed(t.schedule)}</td>
                <td className={`${td} ${tone(t.opponentsDays)}`}>{signed(t.opponentsDays)}</td>
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
