import { describe, it, expect } from 'vitest';
import { nextSort, recordValue, sortRows } from '../tableSort';

describe('nextSort', () => {
  it('cycles best-first, reversed, then back to the default order', () => {
    const a = nextSort(null, 'pts', 'desc', 'Points');
    expect(a).toEqual({ key: 'pts', dir: 'desc', label: 'Points' });
    const b = nextSort(a, 'pts', 'desc', 'Points');
    expect(b?.dir).toBe('asc');
    expect(nextSort(b, 'pts', 'desc', 'Points')).toBeNull();
    // Lower-is-better columns start low to high
    expect(nextSort(null, 'rank', 'asc', 'Rank')?.dir).toBe('asc');
    // Another column starts over at its best-first order
    expect(nextSort(b, 'rank', 'asc', 'Rank')).toEqual({ key: 'rank', dir: 'asc', label: 'Rank' });
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
