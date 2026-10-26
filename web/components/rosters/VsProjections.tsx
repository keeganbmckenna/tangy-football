'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import CustomTooltip from '@/components/CustomTooltip';
import LazyMount from '@/components/ui/LazyMount';
import SectionCard from '@/components/ui/SectionCard';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import TeamName, { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import { useChartHover } from '@/hooks/useChartHover';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { useTableSort } from '@/hooks/useTableSort';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { useTeamColors } from '@/hooks/useTeamColors';
import { CHART_CONFIG, CHART_THEME } from '@/lib/constants';
import { sortRows } from '@/lib/tableSort';
import { vsProjections } from '@/lib/analyze/rosters';
import { PlayerLabel, signed, TD, TH, teamNames, type RostersCardProps } from './shared';

/**
 * Each team's starters against Sleeper's projections from before the games: the running
 * total through the season, and which of its players beat or missed them most
 */
export default function VsProjections({ insights, teamStats }: RostersCardProps) {
  const sort = useTableSort('vsProjections');
  const me = useMyTeam();
  const tap = useTapTooltip()();
  const { setHoveredItem, clearHovered, isHovered, isOtherHovered } = useChartHover<string>();
  const usernames = useMemo(() => teamStats.map((t) => t.username), [teamStats]);
  const teamColors = useTeamColors(teamStats, usernames);
  const data = useMemo(() => vsProjections(insights), [insights]);
  const name = teamNames(teamStats);
  const users = useMemo(() => new Map(teamStats.map((t) => [t.rosterId, t.username])), [teamStats]);

  const chartData = useMemo(() => {
    const weeks = [...new Set(data.flatMap((t) => t.byWeek.map((w) => w.week)))].sort((a, b) => a - b);
    return weeks.map((week) => {
      const row: Record<string, string | number> = { week: `W${week}` };
      for (const t of data) {
        const w = t.byWeek.find((x) => x.week === week);
        const user = users.get(t.rosterId);
        if (w && user) row[user] = Math.round(w.cumulative * 10) / 10;
      }
      return row;
    });
  }, [data, users]);
  if (!chartData.length) return null;

  const byDiff = [...data].sort((a, b) => b.points - b.projected - (a.points - a.projected));
  const rows = sortRows(byDiff, sort.state, (t, key) => ({ diff: t.points - t.projected, points: t.points, projected: t.projected })[key]);

  return (
    <SectionCard
      title="Versus Projections"
      subtitle="How each team's starters scored against Sleeper's projections"
      gradientType="info"
      footer={
        <span>
          Projections are Sleeper&apos;s from before each week&apos;s games, for the players each team started. Above the line is
          a team outscoring them. Best and worst are its starters with the biggest totals above and below their projections.
        </span>
      }
    >
      <div className="border-b border-[var(--border)] p-4 sm:p-6">
        <LazyMount height={360}>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData} {...tap.chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis dataKey="week" tick={{ fill: CHART_THEME.tick }} axisLine={{ stroke: CHART_THEME.axis }} tickLine={{ stroke: CHART_THEME.axis }} />
              <YAxis width={40} tick={{ fill: CHART_THEME.tick }} axisLine={{ stroke: CHART_THEME.axis }} tickLine={{ stroke: CHART_THEME.axis }} />
              <ReferenceLine y={0} stroke={CHART_THEME.axis} />
              <Tooltip
                active={tap.active}
                cursor={{ stroke: CHART_THEME.axis, strokeWidth: 1 }}
                content={<CustomTooltip teams={teamColors} valueFormatter={(v) => signed(v)} />}
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
                  strokeWidth={isHovered(username) || username === me.username ? CHART_CONFIG.strokeWidth.hovered : CHART_CONFIG.strokeWidth.default}
                  strokeOpacity={isOtherHovered(username) ? CHART_CONFIG.opacity.dimmed : CHART_CONFIG.opacity.default}
                  dot={false}
                  activeDot={{ r: CHART_CONFIG.dotRadius.active }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </LazyMount>
      </div>
      <SortStatus sort={sort} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className={`${PIN_TH} py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] bg-[var(--surface)]`}>Team</th>
              <SortableTh sort={sort} col="diff" tip="Starters' points minus their projections, season to date" className={TH}>+/−</SortableTh>
              <SortableTh sort={sort} col="points" className={TH}>Scored</SortableTh>
              <SortableTh sort={sort} col="projected" className={TH}>Projected</SortableTh>
              <th className={`${TH} text-left`}>Best</th>
              <th className={`${TH} text-left`}>Worst</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface-elevated)]">
            {rows.map((t) => {
              const diff = t.points - t.projected;
              const best = t.players[0];
              const worst = t.players[t.players.length - 1];
              return (
                <tr key={t.rosterId} className={mineRow(t.rosterId === me.rosterId)}>
                  <td className={`${PIN_TD} py-3 whitespace-nowrap bg-[var(--surface-elevated)]`}>
                    <TeamName name={name(t.rosterId)} sub={`@${users.get(t.rosterId) ?? ''}`} />
                  </td>
                  <td className={`${TD} font-semibold ${diff >= 0 ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'}`}>{signed(diff)}</td>
                  <td className={TD}>{t.points.toFixed(1)}</td>
                  <td className={`${TD} text-[var(--muted)]`}>{t.projected.toFixed(1)}</td>
                  <td className={`${TD} text-left`}>
                    {best && (
                      <>
                        <PlayerLabel insights={insights} id={best.playerId} /> <span className="text-[var(--success-text)]">{signed(best.diff)}</span>
                      </>
                    )}
                  </td>
                  <td className={`${TD} text-left`}>
                    {worst && worst !== best && (
                      <>
                        <PlayerLabel insights={insights} id={worst.playerId} /> <span className="text-[var(--danger-text)]">{signed(worst.diff)}</span>
                      </>
                    )}
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
