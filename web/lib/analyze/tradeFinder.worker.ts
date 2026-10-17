/**
 * Runs the trade finder off the main thread (a few seconds for a quick search,
 * longer for a deep one), reporting progress as it goes.
 */
import { findTrades, type FinderOptions, type FinderProgress } from './tradeFinder';
import type { TradeDataResponse } from './trade';

export interface FinderRequest {
  data: TradeDataResponse;
  me: number;
  options: FinderOptions;
}

export type FinderMessage =
  | { type: 'progress'; progress: FinderProgress }
  | { type: 'done'; results: ReturnType<typeof findTrades> }
  | { type: 'error'; message: string };

// The worker global, without pulling the WebWorker lib into the app's DOM types
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<FinderRequest>) => void) | null;
  postMessage: (message: FinderMessage) => void;
};

ctx.onmessage = (event) => {
  const { data, me, options } = event.data;
  let last = 0;
  try {
    const results = findTrades(data, me, options, (progress) => {
      // At most ~10 updates a second
      const now = Date.now();
      if (now - last < 100 && progress.stage !== 'done') return;
      last = now;
      ctx.postMessage({ type: 'progress', progress });
    });
    ctx.postMessage({ type: 'done', results });
  } catch (error) {
    ctx.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Trade finder failed' });
  }
};
