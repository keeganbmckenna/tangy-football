'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import type { Drive } from '@/lib/analyze/live';
import LiveScore from '@/components/ui/LiveScore';
import TeamAvatar from '@/components/ui/TeamAvatar';

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
  /** His team's score and opponent (live only), e.g. "10-17" and "vs NO" */
  game?: { score?: string; opponent: string };
  /** Live only: his game is still to come, on, or over ('none' on a bye) */
  state?: 'pre' | 'in' | 'post' | 'none';
  /** Live only, while his game is on: where the ball is, from his team's side */
  drive?: Drive;
  injury?: string | null;
  /** His box score line, e.g. "6/8 rec, 143 yds, 2 TD" */
  stats?: string;
}

export interface MatchupSide {
  name: string;
  /** The manager's Sleeper username */
  username?: string;
  /** The team's photo */
  avatarUrl?: string | null;
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
  const size = 'h-7 w-7 sm:h-9 sm:w-9';
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

/**
 * Each side's cells, with room at the edges. A player whose game is on gets a faint green
 * tint and a bar on his outer edge, across his row and his stat line's.
 */
function cellProps(p: MatchupPlayer | null, right: boolean, pad: string) {
  const playing = p?.state === 'in';
  return {
    className: `${pad} ${right ? 'pl-1 pr-1.5' : 'pl-1.5 pr-1'}`,
    style: playing
      ? {
          backgroundColor: `color-mix(in srgb, ${RESULT_DOT_COLORS.W} 9%, transparent)`,
          boxShadow: `inset ${right ? -2 : 2}px 0 0 ${RESULT_DOT_COLORS.W}`,
        }
      : undefined,
  };
}

/**
 * Where the ball is in his game, like Sleeper: down and distance (a green dot when his team has
 * the ball) or "On defense", and a field bar from his own goal line (left) to the opponent's,
 * with both 20-yard red zones tinted and the ball marked. A team defense is the other way
 * round: down and distance while the opponent has the ball (the marker red once they're inside
 * its 20), and just "Offense on the field" ("On the sideline" on phones), with no bar, while its
 * own offense has it.
 */
function DriveInfo({ drive, right, defense }: { drive: Drive; right: boolean; defense: boolean }) {
  const where = `${drive.downDistance ? `${drive.downDistance} at ` : drive.offense ? 'Ball at ' : ''}${drive.spot}`;
  const ball = Math.min(Math.max(drive.fromOwnGoal, 0), 100);
  const redZone = 'color-mix(in srgb, var(--danger-text) 30%, transparent)';
  const row = `flex items-center gap-1 text-[10px] sm:text-[11px] ${right ? 'justify-end' : ''}`;
  if (defense && drive.offense) {
    return (
      <div className={`mt-0.5 ${row} whitespace-nowrap text-[var(--muted)]`}>
        <span className="sm:hidden">On the sideline</span>
        <span className="hidden sm:inline">Offense on the field</span>
      </div>
    );
  }
  // Phones drop "Defending" (the bar says whose end the ball is in)
  const text = defense ? (
    <>
      <span className="hidden sm:inline">Defending · </span>
      {where.replace(/^Ball at /, '')}
    </>
  ) : drive.offense ? where : `On defense · ${where}`;
  const marker = defense ? (ball <= 20 ? 'var(--danger-text)' : 'var(--foreground)') : drive.offense ? RESULT_DOT_COLORS.W : 'var(--muted)';
  return (
    <div className="mt-0.5">
      <div className={row} style={{ color: drive.offense || defense ? 'var(--foreground)' : 'var(--muted)' }}>
        {drive.offense && <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: RESULT_DOT_COLORS.W }} />}
        <span className="truncate">{text}</span>
      </div>
      <div
        className={`relative mt-1 h-1 w-full max-w-[9rem] rounded-full bg-[var(--border)] ${right ? 'ml-auto' : ''}`}
        title={`Ball at ${drive.spot}: ${Math.round(ball)} yards from ${defense ? 'its' : "his team's"} own goal line`}
      >
        <div className="absolute inset-y-0 left-0 w-1/5 rounded-l-full" style={{ backgroundColor: redZone }} />
        <div className="absolute inset-y-0 right-0 w-1/5 rounded-r-full" style={{ backgroundColor: redZone }} />
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)]"
          style={{ left: `${ball}%`, backgroundColor: marker }}
        />
      </div>
    </div>
  );
}

function PlayerCell({ p, align, projLabel }: { p: MatchupPlayer | null; align: 'left' | 'right'; projLabel: string }) {
  const right = align === 'right';
  if (!p) return <td {...cellProps(null, right, `pt-2 text-sm text-[var(--muted)] ${right ? 'text-right' : ''}`)}>Empty</td>;
  const tone = injuryTone(p.injury);
  const proj = p.projected === null ? null : `${projLabel} ${p.projected.toFixed(1)}`;
  // The clock (green while on) and the NFL score, like Sleeper: "Q3 8:12 10-17 vs NO", on its
  // own line (phones drop kickoff's "ET" and can wrap before the score)
  const et = p.status?.endsWith(' ET');
  const clock = p.status && (
    <span className="whitespace-nowrap" style={p.state === 'in' ? { color: RESULT_DOT_COLORS.W } : undefined}>
      {et ? p.status.slice(0, -3) : p.status}
      {et && <span className="hidden sm:inline"> ET</span>}
    </span>
  );
  const game = p.game && <span className="whitespace-nowrap">{[p.game.score, p.game.opponent].filter(Boolean).join(' ')}</span>;
  // Still to play (or no game): a dash for his points, like Sleeper
  const notYet = p.state === 'pre' || p.state === 'none';
  const injury = tone && <span className="ml-1 font-semibold" style={{ color: tone }}>{p.injury}</span>;
  // Phones: "J. Daniels" and "Jaguars", like Sleeper
  const short = p.position === 'DEF' ? p.name.split(' ').slice(-1)[0] : p.name.replace(/^(\S)\S*\s+(?=\S)/, '$1. ');
  return (
    <td {...cellProps(p, right, 'pt-2')}>
      <div className={`flex items-center gap-1.5 sm:gap-2 ${right ? 'flex-row-reverse text-right' : ''}`}>
        <PlayerPhoto p={p} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[var(--foreground)] sm:text-sm" title={p.name}>
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{p.name}</span>
          </div>
          <div className="truncate text-[11px] text-[var(--muted)] sm:text-xs">
            {[p.position, p.team].filter(Boolean).join(' · ')}
            {injury}
          </div>
          {clock && (
            <div className="text-[10px] text-[var(--muted)] sm:text-[11px]">
              {clock}
              {game && <>{' '}{game}</>}
            </div>
          )}
          {p.drive && <DriveInfo drive={p.drive} right={right} defense={p.position === 'DEF'} />}
        </div>
        {/* Points in the middle, beside the slot, with the projection under them */}
        <div className={`shrink-0 tabular-nums ${right ? 'text-left' : 'text-right'}`}>
          <div className="text-sm font-semibold text-[var(--foreground)]">
            {notYet ? <span className="text-[var(--muted)]" title="Hasn't played yet">–</span> : <LiveScore value={p.points} align={right ? 'left' : 'right'} />}
          </div>
          {p.projected !== null && (
            <div className="text-[11px] text-[var(--muted)] sm:text-xs" title={proj ?? undefined}>
              <span className="hidden sm:inline">{projLabel} </span>
              {p.projected.toFixed(1)}
            </div>
          )}
        </div>
      </div>
    </td>
  );
}

/** A player's box score line, in its own row under his so both players' points line up */
function StatsCell({ p, align }: { p: MatchupPlayer | null; align: 'left' | 'right' }) {
  return (
    <td {...cellProps(p, align === 'right', 'pb-2 align-top')}>
      {p?.stats && (
        <div className={`mt-0.5 text-[11px] leading-snug text-[var(--foreground)] opacity-80 [overflow-wrap:anywhere] sm:text-xs ${align === 'right' ? 'text-right' : ''}`} title={p.stats}>
          {/* Lines break only after a comma or dot, so "1 car" or "1 2PT" stays together */}
          {p.stats.replace(/([,·]?) /g, (m, after: string) => (after ? m : '\u00a0'))}
        </div>
      )}
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
      <div className={`flex items-center gap-2 ${right ? 'flex-row-reverse' : ''}`}>
        <TeamAvatar url={s.avatarUrl} name={s.name} size="h-7 w-7" />
        <div className="min-w-0 truncate text-sm font-semibold text-[var(--foreground)]" title={s.name}>{s.name}</div>
      </div>
      {s.username && <div className="truncate text-xs text-[var(--muted)]">@{s.username}</div>}
      <div className="text-xl font-bold tabular-nums text-[var(--foreground)] sm:text-2xl"><LiveScore value={s.score} align={right ? 'right' : 'left'} /></div>
      {s.sub && <div className="text-xs tabular-nums text-[var(--muted)]">{s.sub}</div>}
    </div>
  );
  const rows = (key: string, left: Array<MatchupPlayer | null>, rightSide: Array<MatchupPlayer | null>, label: (i: number) => string) =>
    Array.from({ length: Math.max(left.length, rightSide.length) }, (_, i) => (
      // Each pair is its own group: the players, then their stat lines
      <tbody key={`${key}${i}`} className="border-t border-[var(--border)] first:border-t-0">
        <tr>
          <PlayerCell p={left[i] ?? null} align="left" projLabel={projLabel} />
          <td className="pt-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label(i)}</td>
          <PlayerCell p={rightSide[i] ?? null} align="right" projLabel={projLabel} />
        </tr>
        <tr>
          <StatsCell p={left[i] ?? null} align="left" />
          <td />
          <StatsCell p={rightSide[i] ?? null} align="right" />
        </tr>
      </tbody>
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
        <div className="overflow-y-auto px-1 pb-4 sm:px-3">
          <table className="w-full table-fixed">
            <colgroup>
              <col />
              <col className="w-9 sm:w-11" />
              <col />
            </colgroup>
            {rows('s', a.starters, b.starters, (i) => SLOT_LABEL[slots[i]] ?? slots[i] ?? '')}
            {(benchA.length > 0 || benchB.length > 0) && (
              <>
                <tbody className="border-t border-[var(--border)]">
                  <tr>
                    <td className="pb-1 pl-1.5 pt-4 text-xs font-semibold text-[var(--muted)]">Bench {benchTotal(benchA).toFixed(2)}</td>
                    <td />
                    <td className="pb-1 pr-1.5 pt-4 text-right text-xs font-semibold text-[var(--muted)]">Bench {benchTotal(benchB).toFixed(2)}</td>
                  </tr>
                </tbody>
                {rows('b', benchA, benchB, () => 'BN')}
              </>
            )}
          </table>
          {footnote && <p className="mt-3 text-xs text-[var(--muted)]">{footnote}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
