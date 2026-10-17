'use client';

import { useCallback, useEffect, useId, useState } from 'react';

type TooltipIndex = number | string | null | undefined;

/**
 * Charts' popups on touch screens: a tap opens the popup at that point, and a
 * second tap on the same point, or a tap anywhere outside the chart, closes
 * it (mouse hover is unchanged). One popup is open at a time among a
 * component's charts, each named by `chart`.
 *
 * Spread `chartProps` on the chart and pass `active` to its <Tooltip>.
 */
export function useTapTooltip() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [touch, setTouch] = useState(false);
  const [open, setOpen] = useState<{ chart: string; index: TooltipIndex } | null>(null);
  const className = useCallback((chart: string) => `tap-chart-${id}-${chart.replace(/[^a-zA-Z0-9_-]/g, '_')}`, [id]);

  useEffect(() => {
    setTouch(window.matchMedia('(hover: none)').matches);
  }, []);

  // A tap outside the open chart closes its popup
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(`.${className(open.chart)}`)) setOpen(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, className]);

  return useCallback(
    (chart = 'chart') => ({
      chartProps: touch
        ? {
            className: className(chart),
            onClick: (state: { activeTooltipIndex?: TooltipIndex } | null) => {
              const index = state?.activeTooltipIndex;
              setOpen((o) => (index == null || (o?.chart === chart && o.index === index) ? null : { chart, index }));
            },
          }
        : {},
      // false keeps the popup hidden; undefined lets the chart show it where tapped
      active: touch && open?.chart !== chart ? false : undefined,
    }),
    [touch, open, className]
  );
}
