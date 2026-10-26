'use client';

import { Fragment, useMemo, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import TeamName, { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import { useTableSort } from '@/hooks/useTableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { sortRows } from '@/lib/tableSort';
import { lineupEfficiency } from '@/lib/analyze/rosters';
import { PlayerLabel, TD, TH, teamNames, type RostersCardProps } from './shared';

/**
 * How well each manager set lineups: points scored against the best lineup it could have
 * started each week, points left on the bench, and losses the best lineup would have won.
 * Tap a team for its costliest week and the start/sit calls behind it.
 */
export default function LineupEfficiency({ insights, teamStats, rosterPositions }: RostersCardProps & { rosterPositions: string[] }) {
  const sort = useTableSort('lineupEfficiency');
  const me = useMyTeam();
  const [open, setOpen] = useState<number | null>(null);
  const data = useMemo(() => lineupEfficiency(insights, rosterPositions), [insights, rosterPositions]);
  const name = teamNames(teamStats);
  const users = new Map(teamStats.map((t) => [t.rosterId, t.username]));
  const byEfficiency = [...data].sort((a, b) => b.efficiency - a.efficiency);
  const rows = sortRows(byEfficiency, sort.state, (t, key) =>
    ({ efficiency: t.efficiency, bench: t.leftOnBench, perfect: t.perfectWeeks, flipped: t.flippedLosses })[key]
  );
  const lowest = Math.min(...data.map((t) => t.efficiency));
  const floor = Math.max(0, Math.floor(lowest * 20) / 20 - 0.05);

  return (
    <SectionCard
      title="Lineup Efficiency"
      subtitle="Points scored against the best lineup each team could have started"
      gradientType="primary"
      footer={
        <span>
          The best lineup is the highest-scoring legal lineup from the players on the roster that week, at the points they
          actually scored (Sleeper&apos;s &quot;max points&quot;), so it&apos;s hindsight: nobody hits 100%. <strong>Lost with a better lineup</strong> counts
          losses where the best lineup would have outscored the opponent. Tap a team for its costliest week.
        </span>
      }
    >
      <SortStatus sort={sort} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className={`${PIN_TH} py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] bg-[var(--surface)]`}>Team</th>
              <SortableTh sort={sort} col="efficiency" tip="Points scored ÷ the best lineup's points" className={TH}>Efficiency</SortableTh>
              <SortableTh sort={sort} col="bench" best="asc" tip="Points the best lineups would have added over the season" className={TH}>Left on bench</SortableTh>
              <SortableTh sort={sort} col="perfect" tip="Weeks it started the best possible lineup" className={TH}>Perfect wks</SortableTh>
              <SortableTh sort={sort} col="flipped" best="asc" tip="Losses the best lineup would have won" tipAlign="right" className={TH}>Lost w/ better lineup</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface-elevated)]">
            {rows.map((t) => {
              const expanded = open === t.rosterId;
              const c = t.costliest;
              return (
                <Fragment key={t.rosterId}>
                  <tr className={`cursor-pointer ${mineRow(t.rosterId === me.rosterId)}`} onClick={() => setOpen(expanded ? null : t.rosterId)} aria-expanded={expanded}>
                    <td className={`${PIN_TD} py-3 whitespace-nowrap bg-[var(--surface-elevated)]`}>
                      <TeamName name={name(t.rosterId)} sub={`@${users.get(t.rosterId) ?? ''}`} />
                    </td>
                    <td className={`${TD} min-w-[8rem]`}>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-[var(--border)]">
                          <div
                            className="h-full rounded-full bg-[var(--accent)]"
                            style={{ width: `${Math.max(0, (t.efficiency - floor) / (1 - floor)) * 100}%` }}
                          />
                        </div>
                        <span className="w-12 text-right font-semibold">{(t.efficiency * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className={TD}>{t.leftOnBench.toFixed(1)}</td>
                    <td className={TD}>
                      {t.perfectWeeks}
                      <span className="text-[var(--muted)]">/{t.weeks}</span>
                    </td>
                    <td className={`${TD} ${t.flippedLosses ? 'font-semibold text-[var(--danger-text)]' : ''}`}>{t.flippedLosses}</td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={5} className="bg-[var(--surface)] px-4 py-3 text-sm text-[var(--foreground)] sm:px-6">
                        {/* Stays in view while the table scrolls sideways */}
                        <div className="sticky left-4 max-w-[calc(100vw-4rem)] whitespace-normal sm:max-w-none">
                        {c ? (
                          <>
                            <div className="font-medium">
                              Week {c.week}
                              {c.opponent !== null && <> vs {name(c.opponent)}</>}: scored {c.points.toFixed(2)}
                              {c.opponentPoints !== null && <> to {c.opponentPoints.toFixed(2)}</>}, best lineup {c.optimal.toFixed(2)}
                              {c.flipped && <span className="ml-1 text-[var(--danger-text)]">(would have won)</span>}
                            </div>
                            <ul className="mt-1 space-y-0.5 text-[var(--muted)]">
                              {c.swaps.map((s) => (
                                <li key={s.in}>
                                  Start <span className="text-[var(--foreground)]"><PlayerLabel insights={insights} id={s.in} /></span> over{' '}
                                  <span className="text-[var(--foreground)]"><PlayerLabel insights={insights} id={s.out} /></span>: +{s.gain.toFixed(1)}
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <span className="text-[var(--muted)]">Started the best possible lineup every week.</span>
                        )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
