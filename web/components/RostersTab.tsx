'use client';

import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RetryButton from '@/components/ui/RetryButton';
import SectionCard from '@/components/ui/SectionCard';
import { useSeasonInsights } from '@/hooks/useSeasonInsights';
import type { TeamStats } from '@/lib/types';
import LineupEfficiency from './rosters/LineupEfficiency';
import PlayerLeaders from './rosters/PlayerLeaders';
import PositionPoints from './rosters/PositionPoints';
import VsProjections from './rosters/VsProjections';
import WaiverReport from './rosters/WaiverReport';

interface RostersTabProps {
  season: string;
  teamStats: TeamStats[];
  rosterPositions: string[];
}

/** Everything about who teams start, pick up and score with, from the season's insights */
export default function RostersTab({ season, teamStats, rosterPositions }: RostersTabProps) {
  const { data, error, retry } = useSeasonInsights(season);
  if (error) {
    return (
      <SectionCard title="Rosters" gradientType="primary">
        <div className="px-6 py-8">
          <p className="text-[var(--muted)]">Couldn&apos;t load the season&apos;s lineups: {error}</p>
          <RetryButton onClick={retry} />
        </div>
      </SectionCard>
    );
  }
  if (!data) return <LoadingSpinner message="Going through every lineup..." />;
  if (!data.weeks) {
    return (
      <SectionCard title="Rosters" gradientType="primary">
        <p className="px-6 py-8 text-[var(--muted)]">Nothing yet: lineups show up here once week 1 is scored.</p>
      </SectionCard>
    );
  }

  const props = { insights: data, teamStats };
  return (
    <>
      {[
        <LineupEfficiency key="lineups" {...props} rosterPositions={rosterPositions} />,
        <VsProjections key="projections" {...props} />,
        <PositionPoints key="positions" {...props} />,
        <PlayerLeaders key="players" {...props} />,
        <WaiverReport key="waivers" {...props} />,
      ].map((card) => (
        <ErrorBoundary key={card.key}>
          <section>{card}</section>
        </ErrorBoundary>
      ))}
    </>
  );
}
