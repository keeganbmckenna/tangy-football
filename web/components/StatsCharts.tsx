'use client';

import { useState } from 'react';
import CumulativeScores from '@/components/CumulativeScores';
import PointsVsMedian from '@/components/PointsVsMedian';
import PowerRankBump from '@/components/PowerRankBump';
import StandingsOverTime from '@/components/StandingsOverTime';
import Segmented from '@/components/ui/Segmented';
import type { TeamStats } from '@/lib/types';

// Each toggle's choice for this visit, so leaving the tab and coming back keeps it
let rememberedRank: 'standings' | 'power' = 'standings';
let rememberedPoints: 'total' | 'median' = 'total';

/** Rank by week: the real standings, or the playoff-odds model's power rankings */
export function RankOverTime(props: {
  standingsData: Record<string, number[]>;
  teams: TeamStats[];
  maxWeek?: number;
  /** Power rankings need the season's odds history (Sleeper seasons) */
  season?: string;
  complete: boolean;
}) {
  const [view, setView] = useState(rememberedRank);
  const pick = (v: typeof view) => {
    rememberedRank = v;
    setView(v);
  };
  const controls = props.season ? (
    <Segmented label="Rank by" value={view} onChange={pick} options={[{ id: 'standings', label: 'Standings' }, { id: 'power', label: 'Power rank' }]} />
  ) : undefined;
  return view === 'power' && props.season ? (
    <PowerRankBump season={props.season} teamStats={props.teams} complete={props.complete} controls={controls} />
  ) : (
    <StandingsOverTime standingsData={props.standingsData} teams={props.teams} maxWeek={props.maxWeek} controls={controls} />
  );
}

/** Points through the season: running totals, or above and below the weekly median */
export function PointsOverTime(props: {
  cumulativeData: Record<string, number[]>;
  differenceData: Record<string, number[]>;
  teams: TeamStats[];
  maxWeek?: number;
}) {
  const [view, setView] = useState(rememberedPoints);
  const pick = (v: typeof view) => {
    rememberedPoints = v;
    setView(v);
  };
  const controls = <Segmented label="Show" value={view} onChange={pick} options={[{ id: 'total', label: 'Total' }, { id: 'median', label: 'vs median' }]} />;
  return view === 'median' ? (
    <PointsVsMedian differenceData={props.differenceData} teams={props.teams} maxWeek={props.maxWeek} controls={controls} />
  ) : (
    <CumulativeScores cumulativeData={props.cumulativeData} teams={props.teams} maxWeek={props.maxWeek} controls={controls} />
  );
}
