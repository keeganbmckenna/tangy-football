'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import LiveScore from '@/components/ui/LiveScore';

export interface MatchupPlayer {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  points: number;
  /** Projected points (live: the projected final; completed: the original projection), if known */
  projected: number | null;
  /** Game status (live only), e.g. "Q3 5:21" */
  status?: string;
  live?: boolean;
  injury?: string | null;
}

export interface MatchupSide {
  name: string;
  score: number;
  /** Under the score, e.g. projected final and win odds */
  sub?: ReactNode;
  starters: Array<MatchupPlayer | null>;
  bench?: MatchupPlayer[];
}

const SLOT_LABEL: Record<string, string> = { SUPER_FLEX: 'SF', REC_FLEX: 'RWT', WRRB_FLEX: 'W/R' };

/** Injury statuses worth flagging: red for ruled out, amber for doubtful or questionable */
const injuryTone = (s?: string | null) =>
  !s ? null : ['Out', 'IR', 'PUP', 'Sus', 'NA', 'DNR', 'COV'].includes(s) ? RESULT_DOT_COLORS.L : s === 'Doubtful' || s === 'Questionable' ? 'var(--warning-text)' : null;

/** A player's Sleeper headshot (a defense's team logo), or his initials if there isn't one */
function PlayerPhoto({ p }: { p: MatchupPlayer }) {
  const [failed, setFailed] = useState(false);
  const src = p.position === 'DEF'
    ? `https://sleepercdn.com/images/team_logos/nfl/${(p.team ?? p.playerId).toLowerCase()}.png`
    : `https://sleepercdn.com/content/nfl/players/thumb/${p.playerId}.jpg`;
  const size = 'h-8 w-8 sm:h-9 sm:w-9';
  if (failed) {
    return (
      <div className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-[var(--neutral-bg)] text-xs font-semibold text-[var(--muted)]`}>
        {p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt=""
      width={36}
      height={36}
      unoptimized
      onError={() => setFailed(true)}
      className={`${size} shrink-0 rounded-full bg-[var(--neutral-bg)] ${p.position === 'DEF' ? 'object-contain p-1' : 'object-cover'}`}
    />
  );
}

function PlayerCell({ p, align, projLabel }: { p: MatchupPlayer | null; align: 'left' | 'right'; projLabel: string }) {
  const right = align === 'right';
  if (!p) return <td className={`py-2 text-sm text-[var(--muted)] ${right ? 'text-right' : ''}`}>Empty</td>;
  const tone = injuryTone(p.injury);
  const proj = p.projected === null ? null : `${projLabel} ${p.projected.toFixed(1)}`;
  const info = (
    <>
      {[p.position, p.team].filter(Boolean).join(' · ')}
      {p.status && (
        <>
          {' · '}
          <span style={p.live ? { color: RESULT_DOT_COLORS.W } : undefined}>{p.status}</span>
        </>
      )}
      {tone && <span className="ml-1 font-semibold" style={{ color: tone }}>{p.injury}</span>}
    </>
  );
  return (
    <td className="py-2">
      <div className={`flex items-center gap-2 ${right ? 'flex-row-reverse text-right' : ''}`}>
        <PlayerPhoto p={p} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--foreground)]" title={p.name}>{p.name}</div>
          {/* Phones: points under the name; wider screens: beside it */}
          <div className="truncate text-xs tabular-nums text-[var(--muted)] sm:hidden">
            <span className="font-semibold text-[var(--foreground)]"><LiveScore value={p.points} showDelta={false} /></span>
            {proj && ` · ${proj}`}
          </div>
          <div className="truncate text-xs text-[var(--muted)]">{info}</div>
        </div>
        <div className={`hidden shrink-0 tabular-nums sm:block ${right ? 'text-left' : 'text-right'}`}>
          <div className="text-sm font-semibold text-[var(--foreground)]"><LiveScore value={p.points} align={right ? 'left' : 'right'} /></div>
          {proj && <div className="text-xs text-[var(--muted)]">{proj}</div>}
        </div>
      </div>
    </td>
  );
}

interface Props {
  title: string;
  a: MatchupSide;
  b: MatchupSide;
  slots: string[];
  /** What the second number is: "proj" */
  projLabel?: string;
  footnote?: ReactNode;
  onClose: () => void;
}

/** Both lineups of a matchup, slot by slot (and the benches, when given), in a dialog */
export default function MatchupDetail({ title, a, b, slots, projLabel = 'proj', footnote, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const head = (s: MatchupSide, right: boolean) => (
    <div className={`min-w-0 flex-1 ${right ? 'text-right' : ''}`}>
      <div className="truncate text-sm font-semibold text-[var(--foreground)]" title={s.name}>{s.name}</div>
      <div className="text-2xl font-bold tabular-nums text-[var(--foreground)]"><LiveScore value={s.score} align={right ? 'right' : 'left'} /></div>
      {s.sub && <div className="text-xs tabular-nums text-[var(--muted)]">{s.sub}</div>}
    </div>
  );
  const rows = (left: Array<MatchupPlayer | null>, rightSide: Array<MatchupPlayer | null>, label: (i: number) => string) =>
    Array.from({ length: Math.max(left.length, rightSide.length) }, (_, i) => (
      <tr key={i}>
        <PlayerCell p={left[i] ?? null} align="left" projLabel={projLabel} />
        <td className="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label(i)}</td>
        <PlayerCell p={rightSide[i] ?? null} align="right" projLabel={projLabel} />
      </tr>
    ));
  const benchA = a.bench ?? [];
  const benchB = b.bench ?? [];
  const benchTotal = (bench: MatchupPlayer[]) => bench.reduce((t, p) => t + p.points, 0);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-t-xl border border-[var(--border)] bg-[var(--solid-elevated)] shadow-2xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[var(--border)] p-4">
          {head(a, false)}
          {head(b, true)}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 shrink-0 rounded-md px-2 py-1 text-lg leading-none text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-3 pb-4 sm:px-4">
          <table className="w-full table-fixed">
            <colgroup>
              <col />
              <col className="w-10 sm:w-11" />
              <col />
            </colgroup>
            <tbody className="divide-y divide-[var(--border)]">
              {rows(a.starters, b.starters, (i) => SLOT_LABEL[slots[i]] ?? slots[i] ?? '')}
              {(benchA.length > 0 || benchB.length > 0) && (
                <>
                  <tr>
                    <td className="pb-1 pt-4 text-xs font-semibold text-[var(--muted)]">Bench {benchTotal(benchA).toFixed(2)}</td>
                    <td />
                    <td className="pb-1 pt-4 text-right text-xs font-semibold text-[var(--muted)]">Bench {benchTotal(benchB).toFixed(2)}</td>
                  </tr>
                  {rows(benchA, benchB, () => 'BN')}
                </>
              )}
            </tbody>
          </table>
          {footnote && <p className="mt-3 text-xs text-[var(--muted)]">{footnote}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
