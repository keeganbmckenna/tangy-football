'use client';

import { useEffect, useState } from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import SectionCard from '@/components/ui/SectionCard';
import TradeAnalyzer from '@/components/TradeAnalyzer';
import TradeHistory from '@/components/TradeHistory';
import type { TradeDataResponse } from '@/lib/analyze/trade';
import type { TeamStats } from '@/lib/types';

interface TradesTabProps {
  season: string;
  isCurrentSeason: boolean;
  teamStats: TeamStats[];
}

/**
 * Trades tab: the analyzer while the current season's trades are still open,
 * and every season's trade history.
 */
export default function TradesTab({ season, isCurrentSeason, teamStats }: TradesTabProps) {
  const [data, setData] = useState<TradeDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCurrentSeason) return;
    let cancelled = false;
    fetch('/api/trade-data')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load rosters and projections');
        return res.json() as Promise<TradeDataResponse>;
      })
      .then((json) => !cancelled && setData(json))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load the trade analyzer'));
    return () => {
      cancelled = true;
    };
  }, [isCurrentSeason]);

  return (
    <div className="space-y-6">
      {isCurrentSeason && (
        <ErrorBoundary>
          <section>
            {error ? (
              <SectionCard title="Trade Analyzer" gradientType="primary">
                <p className="px-6 py-8 text-[var(--muted)]">Couldn&apos;t load the trade analyzer: {error}</p>
              </SectionCard>
            ) : !data ? (
              <LoadingSpinner message="Loading rosters and projections..." />
            ) : data.open ? (
              <TradeAnalyzer data={data} teamStats={teamStats} />
            ) : (
              <SectionCard title="Trade Analyzer" gradientType="primary">
                <p className="px-6 py-8 text-[var(--muted)]">
                  {data.tradeDeadline && data.currentWeek > data.tradeDeadline
                    ? `The trade deadline (week ${data.tradeDeadline}) has passed.`
                    : 'Trades open once the regular season is underway.'}
                </p>
              </SectionCard>
            )}
          </section>
        </ErrorBoundary>
      )}
      <ErrorBoundary>
        <section>
          <TradeHistory season={season} isCurrentSeason={isCurrentSeason} teamStats={teamStats} />
        </section>
      </ErrorBoundary>
    </div>
  );
}
