'use client';

import { useEffect } from 'react';

/**
 * Back and forward (and a reload) return to where each view was scrolled. The site changes views
 * without loading a page, so the browser's own restoring would scroll before the view is back and
 * land at the top. Instead each address's scroll position is kept for this tab's session (not in
 * the history entry's state, which Next's router rewrites), saved as the page scrolls and the
 * moment anything is clicked (before a view change scrolls away), and the app puts it back once
 * the view has rendered (restoreScroll).
 */

const KEY = 'tangy-football:scroll';
const here = () => `${window.location.pathname}${window.location.search}`;

function positions(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

const saveScroll = () => {
  try {
    const all = positions();
    if (all[here()] === window.scrollY) return;
    all[here()] = window.scrollY;
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage off (a private window): back goes to the top, as before
  }
};

/** Where this address was last scrolled in this tab (0 if never) */
export const savedScroll = () => positions()[here()] ?? 0;

let cancelRestore: (() => void) | null = null;

/**
 * Scroll back to y once the page is tall enough (a view can take a moment to load), giving up
 * after a few seconds or as soon as the reader scrolls themselves
 */
export function restoreScroll(y: number) {
  cancelRestore?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
  const stop = () => {
    clearTimeout(timer);
    for (const e of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(e, stop);
    cancelRestore = null;
  };
  const step = () => {
    const room = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.min(y, Math.max(room, 0)) });
    if (room >= y || performance.now() - started > 5000) return stop();
    timer = setTimeout(step, 50);
  };
  for (const e of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(e, stop, { passive: true });
  cancelRestore = stop;
  // After the view has rendered
  timer = setTimeout(step, 0);
}

/** Keep each view's scroll position (once, in the app) */
export function useScrollMemory() {
  useEffect(() => {
    window.history.scrollRestoration = 'manual';
    // After a reload, where the page was
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === 'reload' || nav?.type === 'back_forward') {
      const y = savedScroll();
      if (y > 0) restoreScroll(y);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(saveScroll, 150);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('click', saveScroll, true);
    window.addEventListener('pagehide', saveScroll);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', saveScroll, true);
      window.removeEventListener('pagehide', saveScroll);
    };
  }, []);
}
