'use client';

import BracketBoard, { type BoardGame, type BoardTeam } from '@/components/BracketBoard';
import SectionCard from '@/components/ui/SectionCard';
import { LEGACY_SEASONS, MANAGER_FIRST_NAMES, type LegacyGame } from '@/lib/data/legacyHistory';

interface LegacySeasonOverviewProps {
  season: string;
}

const FINISH: Record<number, string> = { 1: '🏆 Champion', 2: '🥈 Runner-up', 3: '🥉 Third place' };

/** Overview for a season before Sleeper: the final standings and top three, and the playoff bracket where it's known */
export default function LegacySeasonOverview({ season }: LegacySeasonOverviewProps) {
  const data = LEGACY_SEASONS.find((s) => s.season === season);
  if (!data) return null;
  const firstName = (owner: string) =>
    Object.entries(MANAGER_FIRST_NAMES).find(([k]) => k.toLowerCase() === owner.toLowerCase())?.[1] ?? owner;
  const podium = [1, 2, 3]
    .map((place) => ({ place, team: data.teams.find((t) => t.finish === place) }))
    .filter((p) => p.team);
  const teamOf = (owner: string) => data.teams.find((t) => t.owner === owner);
  const slot = (owner: string, won: boolean): BoardTeam => {
    const t = teamOf(owner);
    return { rosterId: t?.rank ?? 0, name: firstName(owner), caption: t?.teamName ?? null, seed: t && t.rank <= data.playoffTeams ? t.rank : null, won };
  };
  // Higher seed on top, as on the Sleeper brackets
  const game = (g: LegacyGame, id: string): BoardGame => {
    const [w, l] = [slot(g.winner, true), slot(g.loser, false)];
    const wTop = (teamOf(g.winner)?.rank ?? 99) < (teamOf(g.loser)?.rank ?? 99);
    return { id, label: g.label, top: wTop ? w : l, bottom: wTop ? l : w };
  };
  const bracket = data.bracket;

  return (
    <div className="space-y-6">
      <SectionCard
        title={`${season} Final Standings`}
        subtitle={`Before Sleeper: only the final standings and the top three were kept, so the other tabs have nothing for this season. ${data.format ? `Playoff: ${data.format.charAt(0).toLowerCase()}${data.format.slice(1)}.` : ''}`.trim()}
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
                <tr key={t.rank} className={t.rank === data.playoffTeams ? 'border-b-2 border-b-[var(--muted)]' : undefined}>
                  <td className="px-4 py-2 text-[var(--muted)]">{t.rank}</td>
                  <td className="px-4 py-2 font-medium text-[var(--foreground)]">{t.teamName}</td>
                  <td className="px-4 py-2 text-[var(--foreground)]">
                    {firstName(t.owner)}
                    {firstName(t.owner) !== t.owner && <span className="ml-1.5 text-xs text-[var(--muted)]">{t.owner}</span>}
                  </td>
                  <td className="px-4 py-2 text-center text-[var(--foreground)]">
                    {t.wins}-{t.losses}
                  </td>
                  <td className="px-4 py-2 text-[var(--foreground)]">
                    {t.finish ? FINISH[t.finish] : data.toiletLoser === t.owner ? '💩 Lost the toilet bowl' : t.rank <= data.playoffTeams ? 'Playoffs' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-[var(--muted)]">
          Standings order as the old platform listed them; the line marks the playoff field, the top {data.playoffTeams}. The league had
          10 teams; see the History tab for how these seasons fit into all-time records.
        </p>
      </SectionCard>
      {bracket && (
        <SectionCard
          title={`${season} Playoffs`}
          subtitle="Who beat whom, from the league's group chat (no scores were kept)"
          gradientType="success"
        >
          <div className="p-4 sm:p-6">
            <BracketBoard
              columns={bracket.rounds.map((round) => ({
                title: round.title,
                note: round.title === 'Round 1' ? `Byes: 1. ${firstName(data.teams[0].owner)} · 2. ${firstName(data.teams[1].owner)}` : undefined,
                games: round.games.map((g, i) => game(g, `${round.title}-${i}`)),
              }))}
              extras={{ title: 'Other games', games: bracket.other.map((g, i) => game(g, `other-${i}`)) }}
            />
            {bracket.note && <p className="mt-4 text-xs text-[var(--muted)]">{bracket.note}</p>}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
