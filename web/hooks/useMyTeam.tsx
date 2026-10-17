'use client';

import { createContext, useContext } from 'react';

/** Which manager "you" are, picked once and saved on this device */
export const MY_TEAM_STORAGE_KEY = 'tangy-my-team';

export interface MyTeam {
  /** Sleeper user ID (the same across seasons), or null if not picked */
  userId: string | null;
  /** Their roster in the season being shown, if they're in it */
  rosterId: number | null;
  /** Their Sleeper username in that season, for tables keyed by it */
  username: string | null;
  setUserId: (userId: string | null) => void;
}

export const MyTeamContext = createContext<MyTeam>({ userId: null, rosterId: null, username: null, setUserId: () => {} });

export const useMyTeam = () => useContext(MyTeamContext);

/** Class for a table row that's your team: an accent bar and tint on its first cell (globals.css) */
export const mineRow = (mine: boolean) => (mine ? 'mine' : '');

export function readMyTeam(): string | null {
  try {
    return window.localStorage.getItem(MY_TEAM_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveMyTeam(userId: string | null) {
  try {
    if (userId) window.localStorage.setItem(MY_TEAM_STORAGE_KEY, userId);
    else window.localStorage.removeItem(MY_TEAM_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode): the pick lasts this visit only
  }
}
