'use client';

import { useMemo } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import TeamName, { PIN_TD, PIN_TH, WIDE_ONLY } from '@/components/ui/TeamName';
import { useTableSort } from '@/hooks/useTableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { sortRows } from '@/lib/tableSort';
import { consistency } from '@/lib/analyze/consistency';
import type { TeamStats } from '@/lib/types';

interface ScoreDistributionProps {
  teams: TeamStats[];
  maxWeek: number;
}

/**
 * Each team's weekly scores as dots on one line, with its middle half shaded and its median
 * marked, then a table of spread, floor, ceiling, and boom and bust weeks
 * (lib/analyze/consistency.ts)
 */
export default function ScoreDistribution({ teams, maxWeek }: ScoreDistributionProps) {
  const sort = useTableSort('scoreDistribution');
  const me = useMyTeam();
  const { teams: data, leagueQ1, leagueQ3 } = useMemo(() => consistency(teams, maxWeek), [teams, maxWeek]);
  if (!data.length || !data[0].scores.length) return null;

  const byMedian = [...data].sort((a, b) => b.median - a.median);
  const lo = Math.floor(Math.min(...data.map((t) => t.floor)) / 10) * 10;
  const hi = Math.ceil(Math.max(...data.map((t) => t.ceiling)) / 10) * 10;
  const x = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  const step = hi - lo > 120 ? 40 : 20;
  const ticks = Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const rows = sortRows(byMedian, sort.state, (t, key) =>
    ({ median: t.median, mean: t.mean, sd: t.sd, floor: t.floor, ceiling: t.ceiling, booms: t.booms, busts: t.busts })[key]
  );
  const th = 'px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-[var(--muted)] sm:px-4';
  const td = 'px-3 py-3 whitespace-nowrap text-center text-sm tabular-nums text-[var(--foreground)] sm:px-4';

  return (
    <SectionCard
      title="Score Distribution"
      subtitle="Every weekly score, and how spread out they were"
      gradientType="info"
      footer={
        <span>
          Each dot is a week. The shaded band is the team&apos;s middle half of weeks and the line is its median. Booms are
          weeks above {leagueQ3.toFixed(1)} (the league&apos;s top quarter of scores) and busts below {leagueQ1.toFixed(1)} (its
          bottom quarter); a team with more booms is mostly just a better team. SD is how far its scores landed from its
          average this season. That&apos;s mostly chance: across thousands of other leagues, a team&apos;s spread barely carries
          over from the first half of a season to the second, so a low SD so far doesn&apos;t make a team steady.
        </span>
      }
    >
      <div className="border-b border-[var(--border)] p-4 sm:p-6">
        <div className="space-y-2">
          {byMedian.map((t) => {
            const mine = t.rosterId === me.rosterId;
            return (
              <div key={t.rosterId} className="flex items-center gap-2 sm:gap-3">
                <div
                  className={`w-24 shrink-0 truncate text-xs sm:w-36 sm:text-sm ${mine ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--muted)]'}`}
                  title={t.teamName}
                >
                  {t.teamName}
                </div>
                <div className="relative h-6 flex-1">
                  <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
                  <div
                    className="absolute top-1 bottom-1 rounded bg-[var(--accent)] opacity-20"
                    style={{ left: x(t.q1), width: `calc(${x(t.q3)} - ${x(t.q1)})` }}
                  />
                  <div className="absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-[var(--foreground)]" style={{ left: x(t.median) }} />
                  {t.scores.map((v, i) => (
                    <div
                      key={i}
                      title={`Week ${i + 1}: ${v.toFixed(2)}`}
                      className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        left: x(v),
                        backgroundColor: v > leagueQ3 ? 'var(--success-text)' : v < leagueQ1 ? 'var(--danger-text)' : 'var(--muted)',
                        opacity: 0.85,
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {/* Axis */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-24 shrink-0 sm:w-36" />
            <div className="relative h-4 flex-1 text-[10px] text-[var(--muted)] sm:text-xs">
              {ticks.map((v) => (
                <span key={v} className="absolute -translate-x-1/2 tabular-nums" style={{ left: x(v) }}>
                  {v}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <SortStatus sort={sort} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className={`${PIN_TH} py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] bg-[var(--surface)]`}>Team</th>
              <SortableTh sort={sort} col="median" className={`${th} ${WIDE_ONLY}`}>Median</SortableTh>
              <SortableTh sort={sort} col="mean" className={th}>Avg</SortableTh>
              <SortableTh sort={sort} col="sd" best="asc" tip="How far its weekly scores landed from its average. Mostly chance: it barely carries over from one half of a season to the other" className={th}>SD</SortableTh>
              <SortableTh sort={sort} col="floor" tip="Lowest score" className={`${th} ${WIDE_ONLY}`}>Floor</SortableTh>
              <SortableTh sort={sort} col="ceiling" tip="Highest score" className={`${th} ${WIDE_ONLY}`}>Ceiling</SortableTh>
              <SortableTh sort={sort} col="booms" tip="Weeks in the league's top quarter of scores (mostly a sign of a good team)" className={th}>Booms</SortableTh>
              <SortableTh sort={sort} col="busts" best="asc" tip="Weeks in the league's bottom quarter of scores" tipAlign="right" className={th}>Busts</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface-elevated)]">
            {rows.map((t) => (
              <tr key={t.rosterId} className={mineRow(t.rosterId === me.rosterId)}>
                <td className={`${PIN_TD} py-3 whitespace-nowrap bg-[var(--surface-elevated)]`}>
                  <TeamName name={t.teamName} sub={`@${t.username}`} />
                </td>
                <td className={`${td} ${WIDE_ONLY}`}>{t.median.toFixed(1)}</td>
                <td className={td}>{t.mean.toFixed(1)}</td>
                <td className={td}>{t.sd.toFixed(1)}</td>
                <td className={`${td} ${WIDE_ONLY}`}>{t.floor.toFixed(1)}</td>
                <td className={`${td} ${WIDE_ONLY}`}>{t.ceiling.toFixed(1)}</td>
                <td className={`${td} text-[var(--success-text)]`}>{t.booms}</td>
                <td className={`${td} text-[var(--danger-text)]`}>{t.busts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
