'use client';

import { useEffect, useRef, useState } from 'react';
import { useMyTeam } from '@/hooks/useMyTeam';
import SectionCard from '@/components/ui/SectionCard';
import { formatOdds } from '@/lib/analyze/playoffOdds';
import type { TradeDataResponse } from '@/lib/analyze/trade';
import type { FinderProgress, FoundTrade } from '@/lib/analyze/tradeFinder';
import type { FinderMessage, FinderRequest } from '@/lib/analyze/tradeFinder.worker';
import type { TeamStats } from '@/lib/types';

interface TradeFinderProps {
  data: TradeDataResponse;
  teamStats: TeamStats[];
  /** Load a found trade into the analyzer */
  onOpen: (me: number, trade: FoundTrade) => void;
}

const STAGE_LABEL: Record<FinderProgress['stage'], string> = {
  screening: 'Checking every trade',
  rescoring: 'Re-scoring the best week by week',
  simulating: 'Simulating the finalists’ seasons',
  done: 'Done',
};

function Change({ before, after, bad = false }: { before: number; after: number; bad?: boolean }) {
  const d = (after - before) * 100;
  const tone = Math.abs(d) < 0.5 ? 'var(--muted)' : (bad ? d < 0 : d > 0) ? 'var(--success-text)' : 'var(--danger-text)';
  return (
    <span className="whitespace-nowrap">
      <span className="text-[var(--muted)]">{formatOdds(before)}</span>
      <span className="mx-1 text-[var(--muted)]">→</span>
      <span className="font-semibold text-[var(--foreground)]">{formatOdds(after)}</span>
      <span className="ml-1 text-xs font-semibold" style={{ color: tone }}>
        {Math.abs(d) < 0.5 ? '~0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)}`}
      </span>
    </span>
  );
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

export default function TradeFinder({ data, teamStats, onOpen }: TradeFinderProps) {
  // Starts on your team, if you've picked one in the header
  const myTeam = useMyTeam();
  const [me, setMe] = useState<number | null>(myTeam.rosterId);
  const [marketFilter, setMarketFilter] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<FinderProgress | null>(null);
  const [results, setResults] = useState<{ me: number; deep: boolean; marketFilter: boolean; trades: FoundTrade[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const manager = (id: number) => teamStats.find((t) => t.rosterId === id)?.username.trim() ?? `Team ${id}`;
  const player = (id: string) => {
    const p = data.players[id];
    return p ? `${p.name} (${p.position})` : id;
  };

  const run = (deep: boolean, filter = marketFilter) => {
    if (me === null) return;
    worker.current?.terminate();
    setRunning(true);
    setError(null);
    setProgress(null);
    const request: FinderRequest = { data, me, options: { marketFilter: filter, deep } };
    let w: Worker;
    try {
      w = new Worker(new URL('../lib/analyze/tradeFinder.worker.ts', import.meta.url));
    } catch {
      setRunning(false);
      setError('Your browser can’t run the trade finder in the background.');
      return;
    }
    worker.current = w;
    w.onmessage = (e: MessageEvent<FinderMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') setProgress(msg.progress);
      else if (msg.type === 'done') {
        setResults({ me, deep, marketFilter: filter, trades: msg.results });
        setRunning(false);
        w.terminate();
      } else {
        setError(msg.message);
        setRunning(false);
        w.terminate();
      }
    };
    w.postMessage(request);
  };

  const pct = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <SectionCard
      title="Trade Finder"
      subtitle="Pick your team and find trades that help you without hurting the other manager."
      gradientType="secondary"
    >
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="finder-team">Your team</label>
          <select
            id="finder-team"
            value={me ?? ''}
            onChange={(e) => {
              setMe(e.target.value ? Number(e.target.value) : null);
              setResults(null);
            }}
            className="min-w-[12rem] rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--foreground)]"
          >
            <option value="">Choose your team</option>
            {[...teamStats]
              .sort((x, y) => x.username.localeCompare(y.username, undefined, { sensitivity: 'base' }))
              .map((t) => (
                <option key={t.rosterId} value={t.rosterId}>
                  {t.username}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={me === null || running}
            onClick={() => run(false)}
            className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Find trades
          </button>
          <label className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={marketFilter}
              onChange={(e) => {
                setMarketFilter(e.target.checked);
                if (results && !running) run(results.deep, e.target.checked);
              }}
              className="h-4 w-4"
            />
            Only trades the market sees as fair
          </label>
        </div>

        {running && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-[var(--muted)]">
              <span>{progress ? STAGE_LABEL[progress.stage] : 'Starting'}…</span>
              {progress?.stage === 'screening' && <span>{progress.done.toLocaleString()} of {progress.total.toLocaleString()} trades</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--neutral-bg)]">
              <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}

        {results && !running && (
          <div className="space-y-4">
            {results.trades.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
                No trades found that help {manager(results.me)} without hurting the other manager
                {results.marketFilter ? ' and that the market sees as fair. Try turning off the market filter' : ''}
                {!results.deep ? `${results.marketFilter ? ' or searching' : '. Try searching'} deeper` : ''}.
              </p>
            ) : (
              results.trades.map((t, i) => {
                const gainMe = t.lineup.me[1] - t.lineup.me[0];
                const gainThem = t.lineup.partner[1] - t.lineup.partner[0];
                return (
                  <div key={i} className="rounded-lg border border-[var(--border)] p-4 text-sm">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-[var(--foreground)]">
                        With {manager(t.partner)}
                        <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-[var(--neutral-bg)] px-2 py-0.5 text-xs font-medium text-[var(--neutral-text)]">{t.size}</span>
                        {t.market.fair === false && (
                          <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-[var(--warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--warning-text)]">
                            They overpay by market value
                          </span>
                        )}
                        {t.market.mine === false && (
                          <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-[var(--warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--warning-text)]">
                            You overpay by market value
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpen(results.me, t)}
                        className="rounded-md border border-[var(--border)] px-3 py-1 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--neutral-bg)]"
                      >
                        Open in analyzer
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">You send</div>
                        <div className="text-[var(--foreground)]">{t.gives.map(player).join(', ')}</div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">You get</div>
                        <div className="text-[var(--foreground)]">{t.gets.map(player).join(', ')}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      <div><span className="mr-1 text-xs text-[var(--muted)]">Your playoffs</span><Change before={t.odds.me[0].playoffs} after={t.odds.me[1].playoffs} /></div>
                      <div><span className="mr-1 text-xs text-[var(--muted)]">{manager(t.partner)}&apos;s playoffs</span><Change before={t.odds.partner[0].playoffs} after={t.odds.partner[1].playoffs} /></div>
                      {t.odds.me[0].champion !== null && t.odds.me[1].champion !== null && (
                        <div><span className="mr-1 text-xs text-[var(--muted)]">Your title</span><Change before={t.odds.me[0].champion} after={t.odds.me[1].champion} /></div>
                      )}
                      {t.odds.partner[0].champion !== null && t.odds.partner[1].champion !== null && (
                        <div><span className="mr-1 text-xs text-[var(--muted)]">Their title</span><Change before={t.odds.partner[0].champion} after={t.odds.partner[1].champion} /></div>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Expected lineups {signed(gainMe)} (you) / {signed(gainThem)} (them) pts/wk
                      {data.marketValues && <> · Market value: you give {t.market.give.toLocaleString()}, get {t.market.get.toLocaleString()}</>}
                      {t.moves.meDrops.length > 0 && <> · You drop {t.moves.meDrops.map(player).join(', ')}</>}
                      {t.moves.meAdds.length > 0 && <> · You pick up {t.moves.meAdds.map(player).join(', ')}</>}
                    </p>
                  </div>
                );
              })
            )}
            {!results.deep && (
              <button
                type="button"
                onClick={() => run(true, results.marketFilter)}
                className="text-sm font-medium text-[var(--accent)] underline"
              >
                Search deeper: every player on both rosters (slower)
              </button>
            )}
          </div>
        )}

        <details className="rounded-lg border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          <summary className="cursor-pointer font-medium text-[var(--foreground)]">How this works</summary>
          <div className="mt-3 space-y-2">
            <p>
              It tries 1-for-1, 1-for-2, 2-for-1, 2-for-2, 3-for-1, 1-for-3, 3-for-2 and 2-for-3 trades with every other manager,
              using each roster&apos;s 10 most valuable players (every player in a deeper search; kickers, defenses and players in IR
              slots stay put). Each trade is first scored on both teams&apos; best lineups; the best few hundred are re-scored week by
              week with the roster moves they force; the top 20 get the playoff model&apos;s season simulation, on the same random
              draws as without the trade.
            </p>
            <p>
              A trade is kept only if your odds improve and the other manager&apos;s don&apos;t get worse: their lineup doesn&apos;t
              drop, their playoff and title odds don&apos;t fall, and their odds of losing the toilet bowl don&apos;t rise. Other
              teams can lose a little: playoff spots are fixed, so when two teams both gain, someone else gives it up.
            </p>
            <p>
              The market filter uses FantasyCalc redraft values and hides trades where the other manager gets back less than 85% of
              the value they give. Values are compared with a premium for the best player in a deal (in real trades, a 2-for-1 has
              cost about 1.36× the star&apos;s value). It only sees what the model sees: projections, this season&apos;s production
              and the schedule, not what a manager actually wants. A trade where you get back less than 85% of the value you give
              is marked &ldquo;You overpay by market value&rdquo;: the model may still like it (a position you need), but the other
              manager would likely take it as is, and you may be able to ask for more.
            </p>
          </div>
        </details>
      </div>
    </SectionCard>
  );
}
