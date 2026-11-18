'use client';

import type { ReactNode } from 'react';

/**
 * A card's explanation (how a number is worked out, what a column means), folded away under
 * "How this works" until the viewer opens it. Starts closed on every visit.
 */
export default function HowItWorks({ children, className = '', label = 'How this works' }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <details className={`group text-sm text-[var(--muted)] ${className}`}>
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[11px] font-semibold uppercase tracking-wider hover:text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
        {label}
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">{children}</div>
    </details>
  );
}
