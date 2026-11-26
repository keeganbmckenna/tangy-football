'use client';

import { useCallback, useEffect, useState } from 'react';
import { useOnRefresh } from '@/hooks/useRefresh';
import { liveWeekNumber, type LiveScoresData, type LiveWeekData } from '@/lib/analyze/live';

// While a week is in progress and the tab is visible: scores and game clocks every 10
// seconds while an NFL game is being played (once a minute between games), and the rest
// (projections, injury statuses) every 2 minutes
const SCORES_LIVE_MS = 10_000;
const SCORES_IDLE_MS = 60_000;
const FULL_REFRESH_MS = 120_000;

const isOlder = (fetchedAt: string, shown: string) => Date.parse(fetchedAt) < Date.parse(shown);

/**
 * The week being played as the Live tab sees it (/api/live, with scores merged in from
 * /api/live/scores): loaded once, then polled while the week is live and the page is visible.
 * The Live tab and What If both follow it, so What If's games move with the Live tab's odds.
 */
export function useLiveFeed({ season, regularSeasonEnd, enabled = true }: { season: string; regularSeasonEnd: number; enabled?: boolean }) {
  const [live, setLive] = useState<LiveWeekData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/live', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load live data');
      const data = (await res.json()) as LiveWeekData;
      // Scores older than the ones shown (a cached poll got there first) stay as they are
      setLive((prev) =>
        prev && prev.week === data.week && isOlder(data.fetchedAt, prev.fetchedAt)
          ? { ...data, matchups: prev.matchups, games: prev.games ?? data.games, allowed: prev.allowed, stats: prev.stats, fetchedAt: prev.fetchedAt }
          : data
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load live data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Just scores and clocks, merged into the last full load
  const refreshScores = useCallback(async () => {
    try {
      const res = await fetch('/api/live/scores');
      if (!res.ok) return;
      const data = (await res.json()) as LiveScoresData;
      setLive((prev) =>
        // A poll served from the CDN's cache can be older than what's shown: skip it, so scores don't step back
        prev && prev.week === data.week && !isOlder(data.fetchedAt, prev.fetchedAt)
          ? {
              ...prev,
              matchups: data.matchups,
              games: data.games ?? prev.games,
              allowed: data.allowed ?? prev.allowed,
              stats: data.stats ?? prev.stats,
              fetchedAt: data.fetchedAt,
            }
          : prev
      );
    } catch {
      // The next poll or full refresh catches up
    }
  }, []);

  const week = live ? liveWeekNumber(live.week, live.lastScoredWeek, regularSeasonEnd) : null;
  const gameOn = !!live?.games && Object.values(live.games).some((g) => g.state === 'in');
  const isCurrentSeason = !live || live.season === season;

  // Initial load, then poll while a week is live and the tab is visible
  useEffect(() => {
    if (enabled) refresh();
  }, [refresh, enabled]);
  // The header's refresh button
  useOnRefresh(() => (enabled ? refresh() : undefined));
  useEffect(() => {
    if (!enabled || week === null || !isCurrentSeason) return;
    const visible = () => document.visibilityState === 'visible';
    const full = window.setInterval(() => visible() && refresh(), FULL_REFRESH_MS);
    const scores = window.setInterval(() => visible() && refreshScores(), gameOn ? SCORES_LIVE_MS : SCORES_IDLE_MS);
    // Coming back to the tab: catch up right away
    const onVisible = () => visible() && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(full);
      window.clearInterval(scores);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, week, isCurrentSeason, gameOn, refresh, refreshScores]);

  return { live, error, loading, refresh, week, gameOn, isCurrentSeason };
}
