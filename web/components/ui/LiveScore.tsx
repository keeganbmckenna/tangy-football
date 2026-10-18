'use client';

import { useEffect, useRef, useState } from 'react';
import { RESULT_DOT_COLORS } from '@/lib/constants';

/**
 * A score that flashes when it changes: green with a "+6.40" floating up when it rises,
 * red with "−2.00" when it drops (a fumble, say, or a stat correction). The first value
 * shown doesn't animate.
 */
export default function LiveScore({
  value,
  className = '',
  align = 'left',
  showDelta = true,
}: {
  value: number;
  className?: string;
  /** Which side of the number the change appears on: outside it, away from its text */
  align?: 'left' | 'right';
  /** Off where there's no room beside the number: it only flashes */
  showDelta?: boolean;
}) {
  const prev = useRef<number | null>(null);
  const [change, setChange] = useState<{ delta: number; n: number } | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before === null) return;
    const delta = Math.round((value - before) * 100) / 100;
    if (delta !== 0) setChange((c) => ({ delta, n: (c?.n ?? 0) + 1 }));
  }, [value]);

  const up = !!change && change.delta > 0;
  const color = up ? RESULT_DOT_COLORS.W : RESULT_DOT_COLORS.L;
  return (
    <span className="relative inline-block">
      {/* Keyed so each change replays the animation */}
      <span key={change?.n ?? 0} className={`${change ? 'score-flash' : ''} ${className}`} style={change ? ({ '--flash': color } as React.CSSProperties) : undefined}>
        {value.toFixed(2)}
      </span>
      {change && showDelta && (
        <span
          key={`d${change.n}`}
          aria-hidden
          className={`score-delta pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs font-bold tabular-nums ${align === 'right' ? 'right-full mr-1.5' : 'left-full ml-1.5'}`}
          style={{ color }}
        >
          {up ? '+' : '−'}
          {Math.abs(change.delta).toFixed(2)}
        </span>
      )}
    </span>
  );
}
