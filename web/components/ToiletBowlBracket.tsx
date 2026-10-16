'use client';

import { RealBracketCard } from './PlayoffBracket';
import type { PostseasonBrackets } from '@/lib/analyze/brackets';

interface ToiletBowlBracketProps {
  brackets: PostseasonBrackets | null;
}

export default function ToiletBowlBracket({ brackets }: ToiletBowlBracketProps) {
  return (
    <RealBracketCard
      title="Toilet Bowl"
      subtitle="Battle to avoid last place: the loser of each game advances, and the final's loser finishes last"
      rounds={brackets?.losersRounds ?? []}
      placements={brackets?.losersPlacements ?? []}
      gradientType="warning"
      emptyMessage="Toilet bowl bracket data will appear when the postseason begins."
    />
  );
}
