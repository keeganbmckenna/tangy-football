'use client';

import { useMemo } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import TeamName, { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { useTableSort } from '@/hooks/useTableSort';
import { sortRows } from '@/lib/tableSort';
import { bestPickups, closestBids, usedFaab, waiverTeams, worstBids } from '@/lib/analyze/rosters';
import type { WaiverMove } from '@/lib/analyze/insights';
import { PlayerLabel, TD, TH, teamNames, type RostersCardProps } from './shared';

/**
 * Who won the waiver wire: each team's pickups and what they scored in its starting lineup,
 * the best pickups, and (in FAAB seasons) spending, the costliest misses and the closest bids
 */
export default function WaiverReport({ insights, teamStats }: RostersCardProps) {
  const sort = useTableSort('waiverReport');
  const me = useMyTeam();
  const faab = usedFaab(insights);
  const teams = useMemo(() => waiverTeams(insights), [insights]);
  const name = teamNames(teamStats);
  const users = new Map(teamStats.map((t) => [t.rosterId, t.username]));
  const byPoints = [...teams].sort((a, b) => b.startedPoints - a.startedPoints);
  const rows = sortRows(byPoints, sort.state, (t, key) =>
    ({ moves: t.moves, spent: t.spent, points: t.startedPoints, perDollar: t.spent > 0 ? t.startedPoints / t.spent : 0 })[key]
  );

  const moveList = (moves: WaiverMove[], detail: (m: WaiverMove) => string) => (
    <ol className="divide-y divide-[var(--border)]">
      {moves.map((m, i) => (
        <li key={`${m.playerId}-${m.week}-${m.rosterId}`} className="flex items-center gap-3 py-2">
          <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--muted)]">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--foreground)]">
              <PlayerLabel insights={insights} id={m.playerId} />{' '}
              <span className="text-xs text-[var(--muted)]">{insights.players[m.playerId]?.position}</span>
            </div>
            <div className={`truncate text-xs ${m.rosterId === me.rosterId ? 'font-semibold text-[var(--accent)]' : 'text-[var(--muted)]'}`}>
              {name(m.rosterId)} · week {m.week}
              {m.bid ? ` · $${m.bid}` : m.type === 'free_agent' ? ' · free agent' : ''}
            </div>
          </div>
          <span className="shrink-0 text-right text-sm tabular-nums text-[var(--foreground)]">{detail(m)}</span>
        </li>
      ))}
    </ol>
  );

  return (
    <SectionCard
      title="Waivers"
      subtitle="Who won the waiver wire"
      gradientType="warning"
      footer={
        <span>
          Pickups are waiver claims and free-agent adds. Their points count while they were in the new team&apos;s starting
          lineup, from the week they joined.
          {faab
            ? ` FAAB budget: $${insights.faabBudget}. Closest bids are claims won by the smallest margin over the next bid.`
            : ' This season used waiver priority, not FAAB bids.'}
        </span>
      }
    >
      <SortStatus sort={sort} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className={`${PIN_TH} py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--muted)] bg-[var(--surface)]`}>Team</th>
              <SortableTh sort={sort} col="moves" className={TH}>Pickups</SortableTh>
              {faab && <SortableTh sort={sort} col="spent" tip="FAAB spent this season, per Sleeper (FAAB can also change hands in trades)" className={TH}>Spent</SortableTh>}
              <SortableTh sort={sort} col="points" tip="Points its pickups scored in its starting lineup" className={TH}>Pickup pts</SortableTh>
              {faab && <SortableTh sort={sort} col="perDollar" tip="Pickup points per FAAB dollar spent" tipAlign="right" className={TH}>Pts / $</SortableTh>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] bg-[var(--surface-elevated)]">
            {rows.map((t) => (
              <tr key={t.rosterId} className={mineRow(t.rosterId === me.rosterId)}>
                <td className={`${PIN_TD} py-3 whitespace-nowrap bg-[var(--surface-elevated)]`}>
                  <TeamName name={name(t.rosterId)} sub={`@${users.get(t.rosterId) ?? ''}`} />
                </td>
                <td className={TD}>{t.moves}</td>
                {faab && <td className={TD}>${t.spent}</td>}
                <td className={`${TD} font-semibold`}>{t.startedPoints.toFixed(1)}</td>
                {faab && <td className={`${TD} text-[var(--muted)]`}>{t.spent > 0 ? (t.startedPoints / t.spent).toFixed(1) : '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-6 border-t border-[var(--border)] p-4 sm:p-6 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">Best pickups</h3>
          {moveList(bestPickups(insights), (m) => `${m.startedPoints.toFixed(1)} pts`)}
        </div>
        {faab && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">Most spent for the least</h3>
              {moveList(worstBids(insights), (m) => `${m.startedPoints.toFixed(1)} pts`)}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">Closest bids</h3>
              {moveList(closestBids(insights), (m) => `$${m.bid} to $${m.losingBids[0].bid}`)}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
