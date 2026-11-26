'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { simulatePlayoffOdds, type OddsResult } from '@/lib/analyze/playoffOdds';
import type { TradeDataResponse, TradeModel } from '@/lib/analyze/trade';
import type { OddsRequest } from '@/lib/analyze/trade.worker';

export const SIMS = 20000;
export const SEED = 2026;

/** A simulation request without its id (the worker's OddsRequest) */
export type OddsJob = Omit<OddsRequest, 'id'>;

/**
 * Runs simulations in a worker (falling back to the main thread), one promise per run. Every run
 * with the same seed uses the same random draws, so two runs differ only by what changed.
 */
export function useOddsWorker(): (job: OddsJob) => Promise<OddsResult> {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (r: OddsResult) => void>());
  const nextId = useRef(1);

  useEffect(() => {
    try {
      const w = new Worker(new URL('../lib/analyze/trade.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; result: OddsResult }>) => {
        pending.current.get(e.data.id)?.(e.data.result);
        pending.current.delete(e.data.id);
      };
      worker.current = w;
    } catch {
      worker.current = null;
    }
    const waiting = pending.current;
    return () => {
      worker.current?.terminate();
      worker.current = null;
      waiting.clear();
    };
  }, []);

  return useCallback((job: OddsJob): Promise<OddsResult> => {
    if (!worker.current) {
      return new Promise((resolve) =>
        setTimeout(() => {
          const r = job;
          resolve(simulatePlayoffOdds(r.teams, r.remaining, r.format, r.meanByWeek, r.spread, r.sims, r.seed, r.playoffWeekStart, r.toiletBowl, r.teamSpread, r.forced, r.live));
        }, 0)
      );
    }
    const id = nextId.current++;
    return new Promise((resolve) => {
      pending.current.set(id, resolve);
      worker.current!.postMessage({ ...job, id });
    });
  }, []);
}

/**
 * Season odds for a model (the league with a move in it, or without), simulated in a worker
 * (falling back to the main thread). Every run uses the same random draws, so two runs differ
 * only by the move.
 */
export function useOddsSimulator(data: TradeDataResponse) {
  const run = useOddsWorker();
  return (model: TradeModel): Promise<OddsResult> =>
    run({
      teams: data.teams,
      remaining: data.remaining,
      format: data.format,
      meanByWeek: model.season.meanByWeek,
      spread: model.season.spread,
      teamSpread: model.season.teamSpread,
      sims: SIMS,
      seed: SEED,
      playoffWeekStart: data.playoffWeekStart,
      toiletBowl: data.hasToiletBowl,
      live: model.live?.games,
    });
}

/** Season odds for a model, re-run when its key changes (null while simulating) */
export function useModelOdds(simulate: (m: TradeModel) => Promise<OddsResult>, key: string | null, model: TradeModel | null): OddsResult | null {
  const [state, setState] = useState<{ key: string; odds: OddsResult } | null>(null);
  useEffect(() => {
    if (!key || !model) return;
    let cancelled = false;
    simulate(model).then((odds) => !cancelled && setState({ key, odds }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key && state?.key === key ? state.odds : null;
}
