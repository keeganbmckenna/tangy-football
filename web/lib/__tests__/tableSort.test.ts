import { describe, it, expect } from 'vitest';
import { MAX_TIEBREAKS, nextSort, recordValue, sortKeys, sortRows } from '../tableSort';

describe('nextSort', () => {
  it('cycles best-first, reversed, then back to the default order', () => {
    const a = nextSort(null, 'pts', 'desc', 'Points');
    expect(a).toEqual({ key: 'pts', dir: 'desc', label: 'Points' });
    const b = nextSort(a, 'pts', 'desc', 'Points');
    expect(b?.dir).toBe('asc');
    expect(nextSort(b, 'pts', 'desc', 'Points')).toBeNull();
    // Lower-is-better columns start low to high
    expect(nextSort(null, 'rank', 'asc', 'Rank')?.dir).toBe('asc');
    // Another column starts over at its best-first order, the earlier sort breaking its ties
    expect(nextSort(b, 'rank', 'asc', 'Rank')).toEqual({ key: 'rank', dir: 'asc', label: 'Rank', then: [{ key: 'pts', dir: 'asc', label: 'Points' }] });
  });

  it('keeps earlier sorts as tiebreaks, and dropping a sort goes back to the one before', () => {
    let s = nextSort(null, 'a', 'desc', 'A');
    s = nextSort(s, 'b', 'desc', 'B');
    s = nextSort(s, 'c', 'desc', 'C');
    expect(sortKeys(s)).toEqual(['c', 'b', 'a']);
    // At most MAX_TIEBREAKS earlier sorts
    s = nextSort(s, 'd', 'desc', 'D');
    expect(sortKeys(s)).toEqual(['d', 'c', 'b']);
    expect(MAX_TIEBREAKS).toBe(2);
    // Sorting by a tiebreak again moves it to the front, once
    s = nextSort(s, 'b', 'desc', 'B');
    expect(sortKeys(s)).toEqual(['b', 'd', 'c']);
    // Reversing keeps the tiebreaks
    s = nextSort(s, 'b', 'desc', 'B');
    expect(s?.dir).toBe('asc');
    expect(sortKeys(s)).toEqual(['b', 'd', 'c']);
    // A third tap drops it: back to the one before, with its own tiebreak
    s = nextSort(s, 'b', 'desc', 'B');
    expect(s).toEqual({ key: 'd', dir: 'desc', label: 'D', then: [{ key: 'c', dir: 'desc', label: 'C' }] });
    s = nextSort(nextSort(s, 'd', 'desc', 'D'), 'd', 'desc', 'D');
    expect(s).toEqual({ key: 'c', dir: 'desc', label: 'C' });
    expect(nextSort(nextSort(s, 'c', 'desc', 'C'), 'c', 'desc', 'C')).toBeNull();
    expect(sortKeys(null)).toEqual([]);
  });
});

describe('sortRows', () => {
  const rows = [
    { id: 'a', v: 2 },
    { id: 'b', v: null },
    { id: 'c', v: 5 },
    { id: 'd', v: 2 },
  ];
  const value = (r: (typeof rows)[number]) => r.v;

  it('keeps the original order with no sort, and never changes the input', () => {
    expect(sortRows(rows, null, value)).toBe(rows);
    sortRows(rows, { key: 'v', dir: 'desc', label: '' }, value);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('sorts either way with blanks last and ties in the original order', () => {
    expect(sortRows(rows, { key: 'v', dir: 'desc', label: '' }, value).map((r) => r.id)).toEqual(['c', 'a', 'd', 'b']);
    expect(sortRows(rows, { key: 'v', dir: 'asc', label: '' }, value).map((r) => r.id)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('breaks ties by the earlier sorts, each its own way, blanks last in each', () => {
    const teams = [
      { id: 'a', titles: 1, playoffs: 4 },
      { id: 'b', titles: 2, playoffs: 3 },
      { id: 'c', titles: 1, playoffs: 7 },
      { id: 'd', titles: 1, playoffs: null },
      { id: 'e', titles: 1, playoffs: 7 },
    ];
    const v = (r: (typeof teams)[number], k: string) => r[k as 'titles' | 'playoffs'];
    const order = (state: Parameters<typeof sortRows>[1]) => sortRows(teams, state, v).map((r) => r.id);
    expect(order({ key: 'titles', dir: 'desc', label: '', then: [{ key: 'playoffs', dir: 'desc', label: '' }] })).toEqual(['b', 'c', 'e', 'a', 'd']);
    expect(order({ key: 'titles', dir: 'desc', label: '', then: [{ key: 'playoffs', dir: 'asc', label: '' }] })).toEqual(['b', 'a', 'c', 'e', 'd']);
  });

  it('sorts text', () => {
    const named = [{ n: 'Cam' }, { n: 'aidan' }, { n: 'Bergen' }];
    expect(sortRows(named, { key: 'n', dir: 'asc', label: '' }, (r) => r.n).map((r) => r.n)).toEqual(['aidan', 'Bergen', 'Cam']);
  });
});

describe('recordValue', () => {
  it('orders by win % with ties as half, then by wins', () => {
    expect(recordValue(8, 5, 1)!).toBeGreaterThan(recordValue(8, 6)!);
    expect(recordValue(10, 4)!).toBeGreaterThan(recordValue(5, 2)!);
    expect(recordValue(0, 0)).toBeNull();
  });
});
