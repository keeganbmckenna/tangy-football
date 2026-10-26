'use client';

import { useEffect, useState } from 'react';
import type { SeasonInsights } from '@/lib/analyze/insights';

// One request per season per visit, shared by every card that needs it
const requests = new Map<string, Promise<SeasonInsights>>();

/** Finished seasons are pre-built (scripts/build_season_insights.py); the season in progress is built live */
function load(season: string): Promise<SeasonInsights> {
  let request = requests.get(season);
  if (!request) {
    request = (async () => {
      const file = await fetch(`/data/season-insights/${season}.json`).catch(() => null);
      if (file?.ok) return (await file.json()) as SeasonInsights;
      const res = await fetch(`/api/season-insights/${season}`);
      if (!res.ok) throw new Error('Failed to load the season’s lineups');
      return (await res.json()) as SeasonInsights;
    })();
    request.catch(() => requests.delete(season));
    requests.set(season, request);
  }
  return request;
}

/** A season's lineups, projections and waiver moves (lib/analyze/insights.ts); null while loading */
export function useSeasonInsights(season: string | null | undefined): { data: SeasonInsights | null; error: string | null; retry: () => void } {
  const [state, setState] = useState<{ season: string; data: SeasonInsights | null; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!season) return;
    let cancelled = false;
    load(season)
      .then((data) => !cancelled && setState({ season, data, error: null }))
      .catch((err) => !cancelled && setState({ season, data: null, error: err instanceof Error ? err.message : 'Failed to load' }));
    return () => {
      cancelled = true;
    };
  }, [season, attempt]);

  const current = state?.season === season ? state : null;
  return { data: current?.data ?? null, error: current?.error ?? null, retry: () => setAttempt((a) => a + 1) };
}
