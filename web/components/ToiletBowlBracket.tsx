'use client';

import { RealBracketCard } from './PlayoffBracket';
import type { PostseasonBrackets } from '@/lib/analyze/brackets';
import type { LeagueData } from '@/lib/types';

interface ToiletBowlBracketProps {
  brackets: PostseasonBrackets | null;
  leagueData?: LeagueData | null;
}

export default function ToiletBowlBracket({ brackets, leagueData }: ToiletBowlBracketProps) {
  return (
    <RealBracketCard
      leagueData={leagueData}
      title="Toilet Bowl"
      subtitle="Battle to avoid last place: the loser of each game advances, and the final's loser finishes last"
      rounds={brackets?.losersRounds ?? []}
      placements={brackets?.losersPlacements ?? []}
      gradientType="warning"
      emptyMessage="Toilet bowl bracket data will appear when the postseason begins."
    />
  );
}
