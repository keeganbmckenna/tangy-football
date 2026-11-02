'use client';

import { useEffect } from 'react';

/**
 * The browser tab's title follows the view: "Stats · Tangy Football", or while a matchup or a
 * manager page is open, its own ("kbmckenna · Tangy Football"). The app sets the base (tab and
 * season); an open dialog or page sets an override for as long as it's showing.
 */

const SITE = 'Tangy Football';

let base: string[] = [];
const overrides: string[][] = [];
let observer: MutationObserver | null = null;

// As the browser reads a title back: spaces collapsed and trimmed (a team name can end in one)
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const wanted = () => tidy([...(overrides[overrides.length - 1] ?? base), SITE].filter(Boolean).join(' · '));

function apply() {
  const title = wanted();
  if (tidy(document.title) !== title) document.title = title;
  // Next sets the page's own title once it's loaded (after this, on a first visit): put this one
  // back, once per change, so two setters can never loop
  if (!observer) {
    observer = new MutationObserver(() => {
      const title = wanted();
      if (tidy(document.title) === title) return;
      observer!.disconnect();
      document.title = title;
      observer!.observe(document.head, { childList: true, subtree: true, characterData: true });
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
}

/** The tab's base title: the tab and season (parts before the site's name; empty ones left out) */
export function usePageTitleBase(parts: Array<string | null | undefined>) {
  const key = parts.filter(Boolean).join('\u0000');
  useEffect(() => {
    base = key ? key.split('\u0000') : [];
    apply();
  }, [key]);
}

/** A title for as long as this view shows (a matchup's lineups, a manager page) */
export function usePageTitle(parts: Array<string | null | undefined>) {
  const key = parts.filter(Boolean).join('\u0000');
  useEffect(() => {
    const entry = key ? key.split('\u0000') : [];
    overrides.push(entry);
    apply();
    return () => {
      overrides.splice(overrides.lastIndexOf(entry), 1);
      apply();
    };
  }, [key]);
}
