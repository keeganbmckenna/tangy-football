'use client';

import SectionCard from './ui/SectionCard';
import BracketBoard, { type BoardColumn, type BoardTeam } from './BracketBoard';
import type { BracketGameView, BracketRoundView, BracketTeamView, PostseasonBrackets } from '@/lib/analyze/brackets';
import type { GRADIENT_STYLES } from '@/lib/constants';

const toBoardTeam = (t: BracketTeamView): BoardTeam =>
  t.rosterId === null
    ? { rosterId: null, name: 'TBD', placeholder: 'TBD' }
    : {
        rosterId: t.rosterId,
        name: t.name,
        username: t.username,
        avatarUrl: t.avatarUrl,
        seed: t.seed,
        score: t.score,
        won: t.isWinner,
      };

const weekLabel = (weeks: number[]) =>
  !weeks.length ? '' : weeks.length === 1 ? `Week ${weeks[0]}` : `Weeks ${weeks[0]}-${weeks[weeks.length - 1]}`;

/** Teams that first appear in round 2 skipped round 1 */
function byesNote(rounds: BracketRoundView[]): string | undefined {
  if (rounds.length < 2) return undefined;
  const ids = (r: BracketRoundView) => r.games.flatMap((g) => [g.team1, g.team2]).filter((t) => t.rosterId !== null);
  const inRound1 = new Set(ids(rounds[0]).map((t) => t.rosterId));
  const byes = ids(rounds[1])
    .filter((t) => !inRound1.has(t.rosterId))
    .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
  return byes.length ? `Byes: ${byes.map((t) => `${t.seed ?? '–'}. ${t.name}`).join(' · ')}` : undefined;
}

interface RealBracketCardProps {
  title: string;
  subtitle: string;
  gradientType: keyof typeof GRADIENT_STYLES;
  rounds: BracketRoundView[];
  placements: BracketGameView[];
  emptyMessage: string;
}

/** A real (Sleeper) bracket in the shared bracket layout */
export function RealBracketCard({ title, subtitle, gradientType, rounds, placements, emptyMessage }: RealBracketCardProps) {
  const columns: BoardColumn[] = rounds.map((round, i) => ({
    title: round.title,
    subtitle: round.weekLabel,
    note: i === 0 ? byesNote(rounds) : undefined,
    games: round.games.map((g) => ({ id: g.id, label: g.label, top: toBoardTeam(g.team1), bottom: toBoardTeam(g.team2) })),
  }));
  const extras = {
    title: 'Placement games',
    games: [...placements]
      .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))
      .map((g) => ({ id: g.id, label: g.label, subtitle: weekLabel(g.weeks), top: toBoardTeam(g.team1), bottom: toBoardTeam(g.team2) })),
  };
  return (
    <SectionCard title={title} subtitle={subtitle} gradientType={gradientType}>
      <div className="p-6">
        {rounds.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted)]">{emptyMessage}</div>
        ) : (
          <BracketBoard columns={columns} extras={extras} />
        )}
      </div>
    </SectionCard>
  );
}

interface PlayoffBracketProps {
  brackets: PostseasonBrackets | null;
}

export default function PlayoffBracket({ brackets }: PlayoffBracketProps) {
  return (
    <RealBracketCard
      title="Playoff Bracket"
      subtitle="League championship bracket"
      rounds={brackets?.winnersRounds ?? []}
      placements={brackets?.winnersPlacements ?? []}
      gradientType="primary"
      emptyMessage="Playoff bracket data will appear once the postseason begins."
    />
  );
}
