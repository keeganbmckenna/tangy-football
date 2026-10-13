'use client';

import { getHeatmapColorByRatio, RESULT_DOT_COLORS, VIRIDIS_HEATMAP_COLORS } from '@/lib/constants';
import { WeeklyPlayAllStats } from '@/lib/types';
import { formatRecord } from '@/lib/analyze/playEveryone';

interface WeeklyPlayAllProps {
  data: WeeklyPlayAllStats[];
}

export default function WeeklyPlayAll({ data }: WeeklyPlayAllProps) {
  if (!data || data.length === 0) {
    return null;
  }

  const numWeeks = data[0]?.weeklyRecords.length || 0;

  return (
    <div className="bg-[var(--surface-elevated)] rounded-lg shadow-lg overflow-hidden border border-[var(--border)]">
      <div className="bg-gradient-to-r from-teal-600 to-teal-800 px-6 py-4">
        <h2 className="text-2xl font-bold text-white">Weekly Play-All Records</h2>
        <p className="text-teal-100 text-sm mt-1">
          {"Each team's record if they played all other teams every week"}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider sticky left-0 bg-[var(--surface)] z-10">
                Team
              </th>
              {Array.from({ length: numWeeks }, (_, i) => i + 1).map((week) => (
                <th
                  key={week}
                  className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
                >
                  W{week}
                </th>
              ))}
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]">
                Total
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]">
                Win %
              </th>
            </tr>
          </thead>
          <tbody className="bg-[var(--surface-elevated)] divide-y divide-[var(--border)]">
            {data.map((team) => (
              <tr key={team.username}>
                <td className="px-6 py-3 whitespace-nowrap sticky left-0 bg-[var(--surface-elevated)] z-10 border-r border-[var(--border)]">
                  <div className="text-sm font-medium text-[var(--foreground)]">
                    {team.teamName}
                  </div>
                  <div className="text-xs text-[var(--muted)]">@{team.username}</div>
                </td>
                {team.weeklyRecords.map((record) => {
                  const { backgroundColor, textColor } = getHeatmapColorByRatio(record.winPct);
                  const actualResult = record.actualResult;
                  const resultLabel = actualResult === 'W' ? 'Win' : actualResult === 'L' ? 'Loss' : actualResult === 'T' ? 'Tie' : 'Unknown';
                  const resultColor = RESULT_DOT_COLORS[actualResult ?? 'T'];

                  return (
                    <td
                      key={record.week}
                      className="px-3 py-3 whitespace-nowrap text-center text-xs font-semibold"
                      style={{ backgroundColor, color: textColor }}
                      title={`${(record.winPct * 100).toFixed(1)}% win rate • Actual: ${resultLabel}`}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span>{formatRecord(record.wins, record.losses, record.ties)}</span>
                        <span
                          className="h-3 w-3 rounded-full ring-2 ring-white/70"
                          style={{ backgroundColor: resultColor }}
                          aria-label={`Actual matchup: ${resultLabel}`}
                        />
                      </div>
                    </td>
                  );
                })}
                <td className="px-4 py-3 whitespace-nowrap text-center text-sm font-bold bg-[var(--surface)] text-[var(--foreground)]">
                  {formatRecord(team.totalWins, team.totalLosses, team.totalTies)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-center text-sm font-bold bg-[var(--surface)] text-[var(--foreground)]">
                  {(team.overallWinPct * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-3 bg-[var(--surface)] border-t border-[var(--border)]">
        <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
          <span className="font-medium">Legend:</span>
          <div className="flex items-center gap-2">
            <div
              className="h-2 w-28 rounded"
              style={{
                backgroundImage: `linear-gradient(90deg, ${VIRIDIS_HEATMAP_COLORS.join(', ')})`,
              }}
            />
            <span>0% wins</span>
            <span className="text-[var(--muted)]">→</span>
            <span>100% wins</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Actual matchup</span>
            <div className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full ring-2 ring-white/70" style={{ backgroundColor: '#22c55e' }} />
              <span>Win</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full ring-2 ring-white/70" style={{ backgroundColor: '#ef4444' }} />
              <span>Loss</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full ring-2 ring-white/70" style={{ backgroundColor: '#94a3b8' }} />
              <span>Tie/Unknown</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
