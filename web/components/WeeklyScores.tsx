'use client';

import { TeamStats } from '@/lib/types';
import SectionCard from '@/components/ui/SectionCard';
import TeamName, { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import { useTableSort } from '@/hooks/useTableSort';
import { sortRows } from '@/lib/tableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';

interface WeeklyScoresProps {
  teams: TeamStats[];
  maxWeek?: number;
}

export default function WeeklyScores({ teams, maxWeek }: WeeklyScoresProps) {
  // Determine number of weeks from first team, limited to completed weeks
  const totalWeeks = teams[0]?.weeklyScores.length || 0;
  const numWeeks = maxWeek !== undefined ? Math.min(maxWeek, totalWeeks) : totalWeeks;
  const weeks = Array.from({ length: numWeeks }, (_, i) => i + 1);
  const sort = useTableSort('weeklyScores');
  const me = useMyTeam();
  const rows = sortRows(teams, sort.state, (team, key) => {
    // Week columns are w1, w2, …; winAvg and winMargin start with a w too
    if (/^w\d+$/.test(key)) return team.weeklyScores[Number(key.slice(1)) - 1];
    return {
      total: team.totalPoints,
      avg: team.avgPoints,
      winAvg: team.avgPointsInWins,
      winMargin: team.avgWinMargin,
      lossAvg: team.avgPointsInLosses,
      lossMargin: team.avgLossMargin,
    }[key];
  });

  return (
    <SectionCard title="Weekly Scores" gradientType="secondary">
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
                  label={`Week ${week}`}
                  className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
                >
                  W{week}
                </SortableTh>
              ))}
              <SortableTh sort={sort} col="total" className="px-6 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]">
                Total
              </SortableTh>
              <SortableTh sort={sort} col="avg" className="px-6 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]">
                Avg
              </SortableTh>
              <SortableTh sort={sort} col="winAvg" className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--success-bg)]">
                Win Avg
              </SortableTh>
              <SortableTh sort={sort} col="winMargin" tip="Average points the team won by" className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--success-bg)]">
                Win Margin
              </SortableTh>
              <SortableTh sort={sort} col="lossAvg" className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--danger-bg)]">
                Loss Avg
              </SortableTh>
              <SortableTh sort={sort} col="lossMargin" tip="Average points the team lost by" tipAlign="right" className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--danger-bg)]">
                Loss Margin
              </SortableTh>
            </tr>
          </thead>
          <tbody className="bg-[var(--surface-elevated)] divide-y divide-[var(--border)]">
            {rows.map((team) => (
              <tr key={team.username} className={mineRow(team.rosterId === me.rosterId)}>
                <td className={`${PIN_TD} py-4 whitespace-nowrap bg-[var(--surface-elevated)]`}>
                  <TeamName name={team.teamName} sub={`@${team.username}`} />
                </td>
                {team.weeklyScores.slice(0, numWeeks).map((score, index) => {
                  const result = team.weeklyResults[index];
                  const opponentScore = team.weeklyOpponentScores[index];
                  const margin = score - opponentScore;
                  const marginText = margin > 0 ? `+${margin.toFixed(2)}` : margin.toFixed(2);

                  return (
                    <td
                      key={index}
                      className={`px-4 py-2 whitespace-nowrap text-center ${
                        result === 'W'
                          ? 'bg-[var(--success-bg)] text-[var(--success-text)]'
                          : result === 'L'
                          ? 'bg-[var(--danger-bg)] text-[var(--danger-text)]'
                          : 'bg-[var(--warning-bg)] text-[var(--warning-text)]'
                      }`}
                    >
                      <div className="text-sm font-semibold">{score.toFixed(2)}</div>
                      <div className={`text-xs font-medium ${
                        result === 'W'
                          ? 'text-[var(--success-text)]'
                          : result === 'L'
                          ? 'text-[var(--danger-text)]'
                          : 'text-[var(--muted)]'
                      }`}>
                        {marginText}
                      </div>
                    </td>
                  );
                })}
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-bold bg-[var(--surface)] text-[var(--foreground)]">
                  {team.totalPoints.toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-center font-bold bg-[var(--surface)] text-[var(--foreground)]">
                  {team.avgPoints.toFixed(2)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-center bg-[var(--success-bg)] text-[var(--foreground)]">
                  {team.avgPointsInWins !== undefined ? (
                    <>
                      <div className="text-sm font-semibold">{team.avgPointsInWins.toFixed(2)}</div>
                      {team.medianPointsInWins !== undefined && (
                        <div className="text-xs text-[var(--muted)]">Med: {team.medianPointsInWins.toFixed(2)}</div>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-center bg-[var(--success-bg)]">
                  {team.avgWinMargin !== undefined ? (
                    <>
                      <div className="text-sm font-semibold text-[var(--success-text)]">+{team.avgWinMargin.toFixed(2)}</div>
                      {team.medianWinMargin !== undefined && (
                        <div className="text-xs text-[var(--muted)]">Med: +{team.medianWinMargin.toFixed(2)}</div>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-center bg-[var(--danger-bg)] text-[var(--foreground)]">
                  {team.avgPointsInLosses !== undefined ? (
                    <>
                      <div className="text-sm font-semibold">{team.avgPointsInLosses.toFixed(2)}</div>
                      {team.medianPointsInLosses !== undefined && (
                        <div className="text-xs text-[var(--muted)]">Med: {team.medianPointsInLosses.toFixed(2)}</div>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-center bg-[var(--danger-bg)]">
                  {team.avgLossMargin !== undefined ? (
                    <>
                      <div className="text-sm font-semibold text-[var(--danger-text)]">{team.avgLossMargin.toFixed(2)}</div>
                      {team.medianLossMargin !== undefined && (
                        <div className="text-xs text-[var(--muted)]">Med: {team.medianLossMargin.toFixed(2)}</div>
                      )}
                    </>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
