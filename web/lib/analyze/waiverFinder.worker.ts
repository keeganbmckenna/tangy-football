/**
 * Runs the waiver finder off the main thread, reporting progress as it goes.
 */
import { findPickups, type WaiverOptions, type WaiverPickup, type WaiverProgress } from './waiverFinder';
import type { TradeDataResponse } from './trade';

export interface WaiverRequest {
  data: TradeDataResponse;
  me: number;
  options: WaiverOptions;
}

export type WaiverMessage =
  | { type: 'progress'; progress: WaiverProgress }
  | { type: 'done'; results: WaiverPickup[] }
  | { type: 'error'; message: string };

// The worker global, without pulling the WebWorker lib into the app's DOM types
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WaiverRequest>) => void) | null;
  postMessage: (message: WaiverMessage) => void;
};

ctx.onmessage = (event) => {
  const { data, me, options } = event.data;
  try {
    const results = findPickups(data, me, options, (progress) => ctx.postMessage({ type: 'progress', progress }));
    ctx.postMessage({ type: 'done', results });
  } catch (error) {
    ctx.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Waiver finder failed' });
  }
};
