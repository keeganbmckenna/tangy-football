'use client';

import SectionCard from '@/components/ui/SectionCard';
import { LEGACY_SEASONS, MANAGER_FIRST_NAMES } from '@/lib/data/legacyHistory';

interface LegacySeasonOverviewProps {
  season: string;
}

const FINISH: Record<number, string> = { 1: '🏆 Champion', 2: '🥈 Runner-up', 3: '🥉 Third place' };

/** Overview for a season before Sleeper: the final standings and top three, all that was kept */
export default function LegacySeasonOverview({ season }: LegacySeasonOverviewProps) {
  const data = LEGACY_SEASONS.find((s) => s.season === season);
  if (!data) return null;
  const firstName = (owner: string) =>
    Object.entries(MANAGER_FIRST_NAMES).find(([k]) => k.toLowerCase() === owner.toLowerCase())?.[1] ?? owner;
  const podium = [1, 2, 3]
    .map((place) => ({ place, team: data.teams.find((t) => t.finish === place) }))
    .filter((p) => p.team);

  return (
    <div className="space-y-6">
      <SectionCard
        title={`${season} Final Standings`}
        subtitle="Before Sleeper: only the final standings and the top three were kept, so the other tabs have nothing for this season."
        gradientType="primary"
      >
        <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-6">
          {podium.map(({ place, team }) => (
            <div key={place} className="rounded-lg border border-[var(--border)] p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{FINISH[place]}</div>
              <div className="mt-1 text-base font-semibold text-[var(--foreground)]">{team!.teamName}</div>
              <div className="text-sm text-[var(--muted)]">
                {firstName(team!.owner)} · {team!.wins}-{team!.losses}
              </div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Team</th>
                <th className="px-4 py-3 font-medium">Manager</th>
                <th className="px-4 py-3 text-center font-medium">Record</th>
                <th className="px-4 py-3 font-medium">Finish</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {data.teams.map((t) => (
                <tr key={t.rank}>
                  <td className="px-4 py-2 text-[var(--muted)]">{t.rank}</td>
                  <td className="px-4 py-2 font-medium text-[var(--foreground)]">{t.teamName}</td>
                  <td className="px-4 py-2 text-[var(--foreground)]">
                    {firstName(t.owner)}
                    {firstName(t.owner) !== t.owner && <span className="ml-1.5 text-xs text-[var(--muted)]">{t.owner}</span>}
                  </td>
                  <td className="px-4 py-2 text-center text-[var(--foreground)]">
                    {t.wins}-{t.losses}
                  </td>
                  <td className="px-4 py-2 text-[var(--foreground)]">{t.finish ? FINISH[t.finish] : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-[var(--muted)]">
          Standings order as the old platform listed them. The league had 10 teams; see the History tab for how these seasons
          fit into all-time records.
        </p>
      </SectionCard>
    </div>
  );
}
