import { describe, it, expect } from 'vitest';
import { readUrlState, urlSearchFor } from '../urlState';

describe('url state', () => {
  it('round-trips a tab and season, leaving out the defaults', () => {
    expect(urlSearchFor('overview', '2026', '2026')).toBe('');
    expect(urlSearchFor('history', '2026', '2026')).toBe('?tab=history');
    expect(urlSearchFor('draft', '2023', '2026')).toBe('?tab=draft&season=2023');
    expect(readUrlState('?tab=draft&season=2023')).toEqual({ tab: 'draft', season: '2023' });
  });

  it('sends links to merged tabs to where their cards went', () => {
    expect(readUrlState('?tab=weekly').tab).toBe('stats');
    expect(readUrlState('?tab=trends&season=2024')).toEqual({ tab: 'stats', season: '2024' });
    expect(readUrlState('?tab=advanced').tab).toBe('stats');
    expect(readUrlState('?tab=trades').tab).toBe('rosters');
  });

  it('ignores unknown tabs and malformed seasons', () => {
    expect(readUrlState('?tab=nope&season=abc')).toEqual({ tab: null, season: null });
    expect(readUrlState('')).toEqual({ tab: null, season: null });
  });
});
