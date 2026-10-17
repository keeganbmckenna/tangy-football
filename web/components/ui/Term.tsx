'use client';

import type { ReactNode } from 'react';

/** The definition bubble, shown on hover or keyboard focus of the surrounding `group/term` */
export function TermTip({ tip, align = 'center' }: { tip: ReactNode; align?: 'center' | 'left' | 'right' }) {
  const pos = align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2';
  return (
    <span
      role="tooltip"
      className={`pointer-events-none invisible absolute top-full z-30 mt-1.5 w-56 rounded-md border border-[var(--border)] bg-[var(--chart-tooltip-bg)] px-2.5 py-1.5 text-left text-xs font-normal normal-case tracking-normal text-[var(--foreground)] opacity-0 shadow-lg transition-opacity group-hover/term:visible group-hover/term:opacity-100 group-focus-within/term:visible group-focus-within/term:opacity-100 ${pos}`}
    >
      {tip}
    </span>
  );
}

/** A bit of jargon with a dotted underline; hover or tap (focus) shows what it means */
export default function Term({ tip, align, children }: { tip: ReactNode; align?: 'center' | 'left' | 'right'; children: ReactNode }) {
  return (
    <span className="group/term relative inline-flex">
      <span tabIndex={0} className="cursor-help underline decoration-dotted decoration-from-font underline-offset-2 outline-none">
        {children}
      </span>
      <TermTip tip={tip} align={align} />
    </span>
  );
}
