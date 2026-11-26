'use client';

import { FootballSpinner } from '@/components/ui/Football';
import SectionCard from '@/components/ui/SectionCard';
import type { CSSProperties } from 'react';
import type { GRADIENT_STYLES } from '@/lib/constants';

interface LoadingSpinnerProps {
  message?: string;
  /** The whole page (the league's first load); otherwise a placeholder in the page */
  fullScreen?: boolean;
  /**
   * The placeholder's height in pixels: about what it stands in for, so nothing below it moves
   * when the content arrives. Content that's a different height on wider screens gives both, and
   * the width (Tailwind's sm, 640px, or md, 768px) where the wider one takes over.
   */
  height?: number | { phone: number; wide: number; from: 'sm' | 'md' };
  /** The card it stands in for: its header shows straight away, with the spinner as its body */
  title?: string;
  subtitle?: string;
  gradientType?: keyof typeof GRADIENT_STYLES;
}

/**
 * The loading state: a tumbling football with a message. In the page it's a placeholder holding
 * the space of what's loading (in that card's header when given a title), so content doesn't pop
 * in and push the rest of the page down. See-through, like the cards, so the chalkboard shows.
 *
 * @example
 * ```tsx
 * <LoadingSpinner title="Trade Values" height={1500} message="Loading trade values..." />
 * ```
 */
export default function LoadingSpinner({ message = 'Loading...', fullScreen = false, height = 480, title, subtitle, gradientType }: LoadingSpinnerProps) {
  if (fullScreen) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-center">
          <FootballSpinner />
          <p className="mt-4 text-[var(--muted)] text-lg">{message}</p>
        </div>
      </div>
    );
  }
  // The spinner sits near the top, where it's seen, however tall the space it holds
  const { phone, wide, from } = typeof height === 'number' ? { phone: height, wide: height, from: 'sm' } : height;
  const body = (
    <div
      className={`flex min-h-[var(--placeholder-h)] justify-center px-4 pt-16 text-center ${
        from === 'md' ? 'md:min-h-[var(--placeholder-wide-h)]' : 'sm:min-h-[var(--placeholder-wide-h)]'
      }`}
      style={{ '--placeholder-h': `${phone}px`, '--placeholder-wide-h': `${wide}px` } as CSSProperties}
      aria-busy="true"
    >
      <div>
        <FootballSpinner />
        <p className="mt-4 text-[var(--muted)]">{message}</p>
      </div>
    </div>
  );
  if (!title) return body;
  return (
    <SectionCard title={title} subtitle={subtitle} gradientType={gradientType}>
      {body}
    </SectionCard>
  );
}

/**
 * Matchup cards while the week's scores load, the same size and grid as the real ones (LiveTab's
 * LiveMatchups and the past weeks in WeeklyMatchups), so the cards below don't move when they arrive
 */
export function MatchupPlaceholders({ count }: { count: number }) {
  const bar = 'rounded bg-[var(--neutral-bg)] motion-safe:animate-pulse';
  const side = (align: 'left' | 'right') => (
    <div className={`flex items-center justify-between gap-2 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <div className={`h-9 w-9 shrink-0 rounded-full ${bar}`} />
      <div className={`flex flex-col gap-1 ${align === 'right' ? 'items-start' : 'items-end'}`}>
        <div className={`h-[26px] w-14 ${bar}`} />
        <div className={`h-3 w-12 ${bar}`} />
      </div>
    </div>
  );
  const name = (align: 'left' | 'right') => (
    <div className={`flex min-w-0 flex-1 flex-col gap-1 ${align === 'right' ? 'items-end' : ''}`}>
      <div className={`h-[18px] w-24 ${bar}`} />
      <div className={`h-3 w-16 ${bar}`} />
    </div>
  );
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:p-6 md:grid-cols-2" aria-busy="true" aria-label="Loading matchups">
      {Array.from({ length: Math.max(count, 1) }, (_, i) => (
        <div key={i} className="rounded-lg border border-[var(--border)] px-3 py-2.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            {side('left')}
            <span className="text-[10px] font-semibold uppercase text-[var(--muted)]">vs</span>
            {side('right')}
          </div>
          <div className="mt-1.5 flex h-4 items-center gap-2">
            <div className={`h-3 w-9 ${bar}`} />
            <div className={`h-2 flex-1 rounded-full ${bar}`} />
            <div className={`h-3 w-9 ${bar}`} />
          </div>
          <div className="mt-1.5 flex gap-3">
            {name('left')}
            {name('right')}
          </div>
        </div>
      ))}
    </div>
  );
}
