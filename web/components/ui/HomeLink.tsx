'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import Football from '@/components/ui/Football';

// Taps on the logo within this window that kick a field goal
const MASH_TAPS = 5;
const MASH_WINDOW_MS = 2000;

/**
 * The league logo and name: a link home (Overview, current season, the plain
 * address). Easter egg: mashing it (5 quick taps) kicks a field goal. The ball
 * flies up from the bottom of the screen, end over end, through the uprights
 * (now and then it sails wide right). With reduced motion, just the result shows.
 */
export default function HomeLink({ children, onHome }: { children: ReactNode; onHome: () => void }) {
  const [kick, setKick] = useState<{ id: number; good: boolean } | null>(null);
  const taps = useRef<number[]>([]);
  // Stable, so the page re-rendering mid-kick doesn't restart it
  const done = useCallback(() => setKick(null), []);

  return (
    <>
      <Link
        href="/"
        onClick={(e) => {
          // A plain click goes home in place; new-tab and modified clicks follow the link
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onHome();
          const now = Date.now();
          taps.current = [...taps.current.filter((t) => now - t < MASH_WINDOW_MS), now];
          if (taps.current.length >= MASH_TAPS) {
            taps.current = [];
            setKick((k) => ({ id: (k?.id ?? 0) + 1, good: Math.random() > 0.2 }));
          }
        }}
        aria-label="Home: Overview for the current season"
        className="flex items-center justify-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] [-webkit-tap-highlight-color:transparent]"
      >
        {children}
      </Link>
      {/* Rendered at the page level: the header's blur would otherwise confine a fixed overlay to the header */}
      {kick && createPortal(<Kick key={kick.id} good={kick.good} onDone={done} />, document.body)}
    </>
  );
}

function Kick({ good, onDone }: { good: boolean; onDone: () => void }) {
  const ballRef = useRef<HTMLDivElement | null>(null);
  const postsRef = useRef<SVGSVGElement | null>(null);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    const ball = ballRef.current;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const posts = postsRef.current;
    const timers: number[] = [];
    if (ball && posts && !still) {
      // Aim between the uprights, above the crossbar (a miss sails past the right post)
      const b = ball.getBoundingClientRect();
      const g = posts.getBoundingClientRect();
      const endX = g.left + g.width * (good ? 0.5 : 1.12) - (b.left + b.width / 2);
      const endY = g.top + g.height * 0.16 - (b.top + b.height / 2);
      const flight = ball.animate(
        [
          { transform: 'translate(-50%, 0) translate(0px, 0px) rotate(0deg) scale(1.6)', opacity: 1 },
          { transform: `translate(-50%, 0) translate(${endX * 0.4}px, ${endY * 0.75}px) rotate(540deg) scale(0.8)`, opacity: 1, offset: 0.6 },
          { transform: `translate(-50%, 0) translate(${endX}px, ${endY}px) rotate(900deg) scale(0.35)`, opacity: 0.9 },
        ],
        { duration: 1100, easing: 'cubic-bezier(.25,.6,.45,1)', fill: 'forwards' }
      );
      flight.onfinish = () => setShowResult(true);
    } else {
      setShowResult(true);
    }
    timers.push(window.setTimeout(onDone, still ? 1600 : 2600));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [good, onDone]);

  return (
    <div className="field-goal pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-live="polite">
      {/* Uprights */}
      <svg ref={postsRef} viewBox="0 0 120 150" className="absolute left-1/2 top-[28%] h-40 w-32 -translate-x-1/2" aria-hidden>
        <g fill="none" stroke="#facc15" strokeWidth={5} strokeLinecap="round">
          <path d="M15 8 V70 H105 V8" />
          <path d="M60 70 V145" />
        </g>
      </svg>
      <div ref={ballRef} className="absolute bottom-[8%] left-1/2 h-12 w-12" style={{ transform: 'translate(-50%, 0)' }}>
        <Football className="h-full w-full" />
      </div>
      {showResult && (
        <div className="field-goal-result absolute left-1/2 top-[calc(28%+11rem)] -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--chart-tooltip-bg)] px-4 py-1.5 text-lg font-bold shadow-lg">
          {good ? <span className="text-[#facc15]">IT&apos;S GOOD! 🏈</span> : <span className="text-[var(--muted)]">Wide right 😬</span>}
        </div>
      )}
    </div>
  );
}
