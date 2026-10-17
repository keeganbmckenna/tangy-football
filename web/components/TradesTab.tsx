'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import SectionCard from '@/components/ui/SectionCard';
import TradeAnalyzer, { type TradePreset } from '@/components/TradeAnalyzer';
import TradeFinder from '@/components/TradeFinder';
import TradeHistory from '@/components/TradeHistory';
import type { TradeDataResponse } from '@/lib/analyze/trade';
import type { TeamStats } from '@/lib/types';

interface TradesTabProps {
  season: string;
  isCurrentSeason: boolean;
  teamStats: TeamStats[];
}

/**
 * Trades tab: the analyzer and trade finder while the current season's trades
 * are still open, and every season's trade history.
 */
export default function TradesTab({ season, isCurrentSeason, teamStats }: TradesTabProps) {
  const [data, setData] = useState<TradeDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A trade from the finder, loaded into a fresh analyzer
  const [preset, setPreset] = useState<{ key: number; trade: TradePreset } | null>(null);
  const analyzerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (preset) analyzerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [preset]);

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
          <section ref={analyzerRef} className="scroll-mt-4">
            {error ? (
              <SectionCard title="Trade Analyzer" gradientType="primary">
                <p className="px-6 py-8 text-[var(--muted)]">Couldn&apos;t load the trade analyzer: {error}</p>
              </SectionCard>
            ) : !data ? (
              <LoadingSpinner message="Loading rosters and projections..." />
            ) : data.open ? (
              <TradeAnalyzer key={preset?.key ?? 0} data={data} teamStats={teamStats} initial={preset?.trade ?? null} />
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
      {isCurrentSeason && data?.open && (
        <ErrorBoundary>
          <section>
            <TradeFinder
              data={data}
              teamStats={teamStats}
              onOpen={(me, t) =>
                setPreset((p) => ({ key: (p?.key ?? 0) + 1, trade: { teamA: me, teamB: t.partner, sendA: t.gives, sendB: t.gets } }))
              }
            />
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
