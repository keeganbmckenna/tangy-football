import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useColumnPicker, type PickableColumn } from '@/hooks/useColumnPicker';

const COLUMNS: PickableColumn[] = [
  { key: 'record', label: 'Record', phoneDefault: true },
  { key: 'finals', label: 'Finals' },
  { key: 'close', label: 'Close', from: 'md' },
];

// This test environment has no localStorage of its own
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    clear: () => store.clear(),
  },
});

describe('useColumnPicker', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts from the phone defaults, other columns showing from their own width', () => {
    const { result } = renderHook(() => useColumnPicker('t', COLUMNS));
    expect(result.current.col('record')).toBe('table-cell');
    expect(result.current.col('finals')).toBe('hidden sm:table-cell');
    expect(result.current.col('close')).toBe('hidden md:table-cell');
    // A column it doesn't manage shows everywhere
    expect(result.current.col('manager')).toBe('');
  });

  it('toggles columns, every tap counting, and remembers them', () => {
    const { result } = renderHook(() => useColumnPicker('t', COLUMNS));
    act(() => {
      result.current.toggle('record');
      result.current.toggle('finals');
      result.current.toggle('close');
    });
    expect(result.current.col('record')).toBe('hidden sm:table-cell');
    expect(result.current.isShown('finals')).toBe(true);
    expect(result.current.col('close')).toBe('table-cell');
    const again = renderHook(() => useColumnPicker('t', COLUMNS));
    expect(again.result.current.isShown('finals')).toBe(true);
    expect(again.result.current.isShown('record')).toBe(false);
  });

  it('always shows the column the table is sorted by, without picking it', () => {
    const { result } = renderHook(() => useColumnPicker('t', COLUMNS, 'finals'));
    expect(result.current.col('finals')).toBe('table-cell');
    expect(result.current.isShown('finals')).toBe(false);
  });

  it('ignores saved columns the table no longer has', () => {
    window.localStorage.setItem('tangy-football:t-columns', JSON.stringify(['gone', 'finals']));
    const { result } = renderHook(() => useColumnPicker('t', COLUMNS));
    expect(result.current.isShown('finals')).toBe(true);
    expect(result.current.isShown('record')).toBe(false);
  });
});
