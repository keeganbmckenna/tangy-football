'use client';

import type { SeasonInsights } from '@/lib/analyze/insights';
import { fetchFirst, useSharedFetch } from '@/hooks/useSharedFetch';

/**
 * A season's lineups, projections and waiver moves (lib/analyze/insights.ts): finished seasons
 * from the pre-built file (scripts/build_season_insights.py), the season in progress built live
 */
export const useSeasonInsights = (season: string | null | undefined) =>
  useSharedFetch<SeasonInsights>(season ? `insights:${season}` : null, () =>
    fetchFirst([`/data/season-insights/${season}.json`, `/api/season-insights/${season}`], 'the season’s lineups')
  );
