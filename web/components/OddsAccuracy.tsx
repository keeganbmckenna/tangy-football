'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import Term from '@/components/ui/Term';
import { fetchFirst, useSharedFetch } from '@/hooks/useSharedFetch';
import { gameAccuracy, playoffAccuracy, type AccuracyData, type AccuracySummary, type Band } from '@/lib/analyze/accuracy';

/** The address of this card: shareable, and what the links to it use */
export const ACCURACY_LINK = '?tab=postseason&section=accuracy';
/** Asks the app to switch to the Playoffs tab and open this card (components/App.tsx listens) */
export const OPEN_ACCURACY_EVENT = 'tangy:open-accuracy';

/** "How accurate?": opens this card in place (a real link, so it can be shared or opened in a new tab) */
export function AccuracyLink({ className = '' }: { className?: string }) {
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    window.dispatchEvent(new Event(OPEN_ACCURACY_EVENT));
  };
  return (
    <a href={ACCURACY_LINK} onClick={open} className={`text-[var(--accent)] hover:underline ${className}`}>
      How accurate are these odds?
    </a>
  );
}

/** Remembers, per viewer, whether the details are open */
const OPEN_KEY = 'tangy-football:accuracy-open';
const readOpen = () => {
  try {
    return window.localStorage.getItem(OPEN_KEY) === 'true';
  } catch {
    return false;
  }
};

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** "2022–2026" */
const yearSpan = (seasons: string[]) => {
  const sorted = [...new Set(seasons)].sort();
  return sorted.length > 1 ? `${sorted[0]}–${sorted[sorted.length - 1]}` : sorted[0] ?? '';
};

/** One band: what the odds said (shaded), what happened (dot) and the range the true rate likely falls in (line) */
function BandRow({ band, scale, noun, hitWord }: { band: Band; scale: [number, number]; noun: string; hitWord: string }) {
  const [from, to] = scale;
  const x = (v: number) => `${((Math.min(Math.max(v, from), to) - from) / (to - from)) * 100}%`;
  const width = (a: number, b: number) => `${((Math.min(b, to) - Math.max(a, from)) / (to - from)) * 100}%`;
  const label = `${Math.round(band.lo * 100)}–${Math.round(band.hi * 100)}%`;
  return (
    <li className="grid grid-cols-[4.5rem_1fr_5.5rem] items-center gap-2 text-xs sm:grid-cols-[5rem_1fr_7rem]">
      <span className="tabular-nums text-[var(--muted)]">{label}</span>
      <div
        className="relative h-4"
        role="img"
        aria-label={`Odds of ${label}: ${hitWord} ${pct(band.actual)} of ${band.n} ${noun} (likely ${pct(band.low)} to ${pct(band.high)})`}
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
        <div className="absolute inset-y-0 rounded-sm bg-[var(--accent)] opacity-25" style={{ left: x(band.lo), width: width(band.lo, band.hi) }} />
        <div className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[var(--foreground)] opacity-50" style={{ left: x(band.low), width: width(band.low, band.high) }} />
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface-elevated)] bg-[var(--foreground)]"
          style={{ left: x(band.actual) }}
        />
      </div>
      <span className="text-right tabular-nums text-[var(--foreground)]">
        {pct(band.actual)} <span className="text-[var(--muted)]">of {band.n}</span>
      </span>
    </li>
  );
}

function Calibration({ summary, scale, noun, hitWord, caption }: { summary: AccuracySummary; scale: [number, number]; noun: string; hitWord: string; caption: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--foreground)]">{caption}</p>
      <div className="grid grid-cols-[4.5rem_1fr_5.5rem] gap-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] sm:grid-cols-[5rem_1fr_7rem]">
        <span>Odds given</span>
        <span className="flex justify-between">
          <span>{pct(scale[0])}</span>
          <span>{pct(scale[1])}</span>
        </span>
        <span className="text-right">{hitWord}</span>
      </div>
      <ul className="space-y-1.5">
        {summary.bands.map((b) => (
          <BandRow key={b.lo} band={b} scale={scale} noun={noun} hitWord={hitWord} />
        ))}
      </ul>
    </div>
  );
}

/**
 * How accurate the site's odds have been in this league (lib/analyze/accuracy.ts): a one-line
 * answer, then (opened) each band of odds against how often it happened, for single games and
 * for the playoff odds. `focus` changes when a link asks for this card: it opens and scrolls here.
 */
export default function OddsAccuracy({ focus = 0 }: { focus?: number }) {
  const { data, error } = useSharedFetch<AccuracyData>('accuracy', () => fetchFirst(['/data/accuracy.json'], 'the accuracy data'));
  const [openState, setOpen] = useState(readOpen);
  // A link opens it (each link bumps focus) until the viewer closes it again
  const [closedFocus, setClosedFocus] = useState(0);
  const open = openState || focus > closedFocus;
  const [view, setView] = useState<'games' | 'playoffs'>('games');
  const ref = useRef<HTMLDivElement | null>(null);
  const toggle = (next: boolean) => {
    setOpen(next);
    if (!next) setClosedFocus(focus);
    try {
      window.localStorage.setItem(OPEN_KEY, String(next));
    } catch {
      // Not remembered (private browsing): it still toggles
    }
  };

  // A link to this card: bring it into view, again as the cards above it finish loading and grow
  // (until the viewer scrolls themselves)
  useEffect(() => {
    if (!focus || !data) return;
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    const aim = () => !stopped && ref.current?.scrollIntoView({ block: 'start' });
    const ids = [50, 600, 1500, 3000].map((ms) => window.setTimeout(aim, ms));
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    window.addEventListener('keydown', stop);
    return () => {
      ids.forEach((id) => window.clearTimeout(id));
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
      window.removeEventListener('keydown', stop);
    };
  }, [focus, data]);

  const games = useMemo(() => (data ? gameAccuracy(data) : null), [data]);
  const playoffs = useMemo(() => (data ? playoffAccuracy(data) : null), [data]);
  if (error || (data && !games?.n)) return null;
  const span = data ? yearSpan(data.games.map((g) => g.season)) : '';

  return (
    <div ref={ref} className="scroll-mt-20">
      <SectionCard title="How Accurate Are the Odds?" subtitle="This league's results against what the site's odds said" gradientType="info">
        <div className="space-y-3 p-4 sm:p-6">
          {games ? (
            <p className="text-sm text-[var(--foreground)]">
              Favorites won <span className="font-semibold">{pct(games.actual)}</span> of {games.n} regular-season games ({span}); the
              odds said <span className="font-semibold">{pct(games.predicted)}</span>.
            </p>
          ) : (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          )}
          {games && playoffs && (
            <details open={open} onToggle={(e) => e.currentTarget.open !== open && toggle(e.currentTarget.open)}>
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold uppercase tracking-wider text-[var(--muted)] hover:text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
                <span aria-hidden className={`inline-block text-sm transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
                {open ? 'Hide the details' : 'Show the details'}
              </summary>
              <div className="mt-3 space-y-4">
                <div className="flex w-fit gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1" role="group" aria-label="Odds">
                  {[
                    { id: 'games' as const, label: 'Single games' },
                    { id: 'playoffs' as const, label: 'Playoff odds' },
                  ].map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setView(o.id)}
                      aria-pressed={view === o.id}
                      className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        view === o.id ? 'bg-[var(--info-bg)] text-[var(--info-text)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {view === 'games' ? (
                  <Calibration
                    summary={games}
                    scale={[0.5, 1]}
                    noun="games"
                    hitWord="Won"
                    caption="Each game's odds when the week's first game kicked off, from the favorite's side, grouped by the odds given. A dot inside its shaded band means the odds were about right."
                  />
                ) : (
                  <Calibration
                    summary={playoffs}
                    scale={[0, 1]}
                    noun="team-weeks"
                    hitWord="Made it"
                    caption={`Every team's playoff odds at every week of ${yearSpan(data!.playoffs.map((r) => r.season))}, from the draft on, grouped by the odds given (teams already in or out left out). Each team counts once a week, so its weeks lean the same way and the ranges are a little narrower than they should be.`}
                  />
                )}
                <p className="text-xs text-[var(--muted)]">
                  The line around each dot is where the true rate likely falls (80% of the time): bands with few games are noisy.{' '}
                  <Term
                    tip="The average squared miss between the odds and what happened (1 if it happened, 0 if not). Lower is better; always saying 50% scores 0.25."
                    align="left"
                  >
                    Brier score
                  </Term>{' '}
                  {(view === 'games' ? games.brier : playoffs.brier).toFixed(3)}, against 0.250 for a coin flip. The model was built and tested
                  on thousands of other leagues, so this league&apos;s seasons are a fair test of it.
                </p>
              </div>
            </details>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
