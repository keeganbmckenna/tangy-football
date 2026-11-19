'use client';

import { useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import SectionCard from '@/components/ui/SectionCard';
import RetryButton from '@/components/ui/RetryButton';
import TradeAnalyzer, { type TradePreset } from '@/components/TradeAnalyzer';
import TradeFinder from '@/components/TradeFinder';
import WaiverFinder from '@/components/WaiverFinder';
import WaiverAnalyzer, { type WaiverPreset } from '@/components/WaiverAnalyzer';
import type { TradeDataResponse } from '@/lib/analyze/trade';
import type { TeamStats } from '@/lib/types';

interface TradesTabProps {
  teamStats: TeamStats[];
}

/**
 * The trade and waiver tools, at the top of the Rosters tab while the current
 * regular season is in progress: the analyzer and trade finder until the trade
 * deadline, and the waiver analyzer and finder. After the deadline the waiver tools
 * come first, with a note that trades are closed. Past trades are in the History tab.
 */
export default function TradesTab({ teamStats }: TradesTabProps) {
  const [data, setData] = useState<TradeDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the fetch
  const [attempt, setAttempt] = useState(0);
  // A trade from the finder, loaded into a fresh analyzer
  const [preset, setPreset] = useState<{ key: number; trade: TradePreset } | null>(null);
  const analyzerRef = useRef<HTMLElement | null>(null);
  // A pickup from the waiver finder, loaded into a fresh waiver analyzer
  const [waiverPreset, setWaiverPreset] = useState<{ key: number; move: WaiverPreset } | null>(null);
  const waiverRef = useRef<HTMLElement | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (preset) analyzerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [preset]);
  useEffect(() => {
    if (waiverPreset) waiverRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [waiverPreset]);

  // Reload while the page is open, keeping what's shown meanwhile: every minute once the week has
  // kicked off (its games' live odds, and who has played), otherwise for roster moves and injury news
  const live = !!data?.model.live;
  const inSeason = !!data && data.remaining.length > 0;
  useEffect(() => {
    if (!inSeason) return;
    const every = live ? 60_000 : 15 * 60_000;
    const loadedAt = Date.now();
    const check = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt >= every) setAttempt((a) => a + 1);
    };
    const id = window.setInterval(check, 10_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [inSeason, live, data]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/trade-data')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load rosters and projections');
        return res.json() as Promise<TradeDataResponse>;
      })
      .then((json) => !cancelled && setData(json))
      .catch((e) => {
        // A failed reload keeps what's shown; the next one tries again
        if (!cancelled && !loaded.current) setError(e instanceof Error ? e.message : 'Failed to load the trade analyzer');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  useEffect(() => {
    loaded.current = data !== null;
  }, [data]);

  const closed = !!data && !data.open;
  const trades = (
    <ErrorBoundary>
      <section ref={analyzerRef} className="scroll-mt-4">
        {error ? (
          <SectionCard title="Trade Analyzer" gradientType="primary">
            <div className="px-6 py-8">
              <p className="text-[var(--muted)]">Couldn&apos;t load the trade analyzer: {error}</p>
              <RetryButton
                onClick={() => {
                  setError(null);
                  setAttempt((a) => a + 1);
                }}
              />
            </div>
          </SectionCard>
        ) : !data ? (
          <LoadingSpinner message="Loading rosters and projections..." />
        ) : data.open ? (
          <TradeAnalyzer key={preset?.key ?? 0} data={data} teamStats={teamStats} initial={preset?.trade ?? null} />
        ) : (
          // Trades closed: a one-line note under the waiver tools, which are what's still useful
          <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
            <span className="font-semibold text-[var(--foreground)]">Trades are closed.</span>{' '}
            {data.tradeDeadline && data.currentWeek > data.tradeDeadline
              ? `The trade deadline (week ${data.tradeDeadline}) has passed, so the Trade Analyzer and Trade Finder are off until next season. Past trades are in the History tab.`
              : 'The Trade Analyzer and Trade Finder open once the regular season is underway.'}
          </p>
        )}
      </section>
    </ErrorBoundary>
  );
  const finder = data?.open && (
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
  );
  const waivers = data && data.inputs.freeAgents.length > 0 && data.remaining.length > 0 && (
    <>
      <ErrorBoundary>
        <section ref={waiverRef} className="scroll-mt-4">
          <WaiverAnalyzer key={waiverPreset?.key ?? 0} data={data} teamStats={teamStats} initial={waiverPreset?.move ?? null} />
        </section>
      </ErrorBoundary>
      <ErrorBoundary>
        <section>
          <WaiverFinder
            data={data}
            teamStats={teamStats}
            onOpen={(me, add, drop) => setWaiverPreset((p) => ({ key: (p?.key ?? 0) + 1, move: { me, add, drop } }))}
          />
        </section>
      </ErrorBoundary>
    </>
  );

  return (
    <div className="space-y-6">
      {closed ? (
        <>
          {waivers}
          {trades}
        </>
      ) : (
        <>
          {trades}
          {finder}
          {waivers}
        </>
      )}
    </div>
  );
}
