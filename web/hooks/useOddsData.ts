'use client';

import { useEffect, useState } from 'react';
import type { PlayoffOddsResponse } from '@/lib/analyze/playoffOdds';
import type { OddsHistoryResponse } from '@/lib/oddsHistory';
import { fetchFirst, forgetShared, useSharedFetch } from '@/hooks/useSharedFetch';

/** While a week is being played the odds follow its games: reload this often (the Live tab's model refreshes every 30s) */
const LIVE_REFRESH_MS = 60_000;
/** Otherwise roster moves and injury news still move them: reload a page left open this often */
const IDLE_REFRESH_MS = 15 * 60_000;

// One reload clock for every card on the page, so they all share each request
let generation = 0;
let loadedAt = Date.now();
/** How often to reload, from the latest odds (null: not while the season isn't being played) */
let refreshEvery: number | null = null;
const listeners = new Set<() => void>();

function refreshIfStale() {
  if (refreshEvery === null || document.visibilityState !== 'visible' || Date.now() - loadedAt < refreshEvery) return;
  generation++;
  loadedAt = Date.now();
  listeners.forEach((l) => l());
}

/** The reload generation: advances while the page is visible and its odds are older than refreshEvery */
function useGeneration(active: boolean): number {
  const [g, setG] = useState(generation);
  useEffect(() => {
    const listener = () => setG(generation);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const check = () => refreshIfStale();
    const id = window.setInterval(check, 10_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [active]);
  return g;
}

/**
 * The current season's playoff picture and odds (/api/playoff-odds). Reloaded while the page is
 * open (every minute once the week has kicked off), keeping what's shown until the new odds arrive.
 */
export const usePlayoffOdds = (enabled = true) => {
  const g = useGeneration(enabled);
  const result = useSharedFetch<PlayoffOddsResponse>(
    enabled ? (g ? `playoff-odds:${g}` : 'playoff-odds') : null,
    () => fetchFirst(['/api/playoff-odds'], 'playoff odds'),
    'playoff-odds'
  );
  const status = result.data?.status;
  const live = !!result.data?.live;
  useEffect(() => {
    if (status) refreshEvery = status === 'in_progress' ? (live ? LIVE_REFRESH_MS : IDLE_REFRESH_MS) : null;
    // Earlier reloads' responses aren't needed again
    if (g) forgetShared('playoff-odds', `playoff-odds:${g}`);
  }, [status, live, g]);
  return result;
};

/**
 * How the odds moved through a season: finished seasons from the pre-built file
 * (scripts/build_odds_history.py), the season in progress built live
 */
export const useOddsHistory = (season: string | null | undefined, complete = false) =>
  useSharedFetch<OddsHistoryResponse>(season ? `odds-history:${season}` : null, () =>
    fetchFirst([...(complete ? [`/data/odds-history/${season}.json`] : []), `/api/odds-history/${season}`], 'the odds history')
  );
