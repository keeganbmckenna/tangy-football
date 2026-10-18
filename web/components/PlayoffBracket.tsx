'use client';

import SectionCard from './ui/SectionCard';
import BracketBoard, { type BoardColumn, type BoardGame, type BoardTeam } from './BracketBoard';
import { useMatchupLineups } from './useMatchupLineups';
import type { BracketGameView, BracketRoundView, BracketTeamView, PostseasonBrackets } from '@/lib/analyze/brackets';
import type { GRADIENT_STYLES } from '@/lib/constants';
import type { LeagueData } from '@/lib/types';

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
  /** The season's league data, for opening a played game's lineups */
  leagueData?: LeagueData | null;
}

/** A real (Sleeper) bracket in the shared bracket layout; a played game opens both lineups */
export function RealBracketCard({ title, subtitle, gradientType, rounds, placements, emptyMessage, leagueData }: RealBracketCardProps) {
  const lineups = useMatchupLineups(leagueData);
  const board = (g: BracketGameView): BoardGame => {
    const base = { id: g.id, label: g.label, top: toBoardTeam(g.team1), bottom: toBoardTeam(g.team2) };
    // Played: both teams set and scored, in a single week that has lineups
    const week = g.weeks.length === 1 ? g.weeks[0] : null;
    const { team1: x, team2: y } = g;
    if (week === null || x.rosterId === null || y.rosterId === null || x.score === null || y.score === null || !lineups.canOpen(week)) return base;
    const game = {
      week,
      label: g.label,
      a: { rosterId: x.rosterId, name: x.name, points: x.score },
      b: { rosterId: y.rosterId, name: y.name, points: y.score },
    };
    return { ...base, onOpen: () => lineups.openLineups(game), opening: lineups.isLoading(game) };
  };
  const columns: BoardColumn[] = rounds.map((round, i) => ({
    title: round.title,
    subtitle: round.weekLabel,
    note: i === 0 ? byesNote(rounds) : undefined,
    games: round.games.map(board),
  }));
  const extras = {
    title: 'Placement games',
    games: [...placements]
      .sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0))
      .map((g) => ({ ...board(g), subtitle: weekLabel(g.weeks) })),
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
      {lineups.dialog}
    </SectionCard>
  );
}

interface PlayoffBracketProps {
  brackets: PostseasonBrackets | null;
  leagueData?: LeagueData | null;
}

export default function PlayoffBracket({ brackets, leagueData }: PlayoffBracketProps) {
  return (
    <RealBracketCard
      leagueData={leagueData}
      title="Playoff Bracket"
      subtitle="League championship bracket"
      rounds={brackets?.winnersRounds ?? []}
      placements={brackets?.winnersPlacements ?? []}
      gradientType="primary"
      emptyMessage="Playoff bracket data will appear once the postseason begins."
    />
  );
}
