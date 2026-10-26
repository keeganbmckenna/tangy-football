'use client';

import type { PlayoffOddsResponse } from '@/lib/analyze/playoffOdds';
import type { OddsHistoryResponse } from '@/lib/oddsHistory';
import { fetchFirst, useSharedFetch } from '@/hooks/useSharedFetch';

/** The current season's playoff picture and odds (/api/playoff-odds) */
export const usePlayoffOdds = (enabled = true) =>
  useSharedFetch<PlayoffOddsResponse>(enabled ? 'playoff-odds' : null, () => fetchFirst(['/api/playoff-odds'], 'playoff odds'));

/**
 * How the odds moved through a season: finished seasons from the pre-built file
 * (scripts/build_odds_history.py), the season in progress built live
 */
export const useOddsHistory = (season: string | null | undefined, complete = false) =>
  useSharedFetch<OddsHistoryResponse>(season ? `odds-history:${season}` : null, () =>
    fetchFirst([...(complete ? [`/data/odds-history/${season}.json`] : []), `/api/odds-history/${season}`], 'the odds history')
  );
