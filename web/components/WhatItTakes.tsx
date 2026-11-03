'use client';

import { useState } from 'react';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import { percent, signed } from '@/lib/format';
import type { DefenseContext, LiveGame, LiveProjection, MatchupModel } from '@/lib/analyze/live';
import {
  expectedLeft,
  gameScriptNote,
  outcomes,
  playerSwings,
  playersLeft,
  swaps,
  target,
  type SideKey,
} from '@/lib/analyze/whatItTakes';
import type { SleeperMatchup } from '@/lib/types';

/** Remembers, per viewer, whether the panel is collapsed */
const OPEN_KEY = 'tangy-football:what-it-takes-open';

// Collapsed until this viewer opens it (then remembered either way)
const readOpen = () => {
  try {
    return window.localStorage.getItem(OPEN_KEY) === 'true';
  } catch {
    return false;
  }
};

/** Players listed under "Who swings it" */
const SWINGS_SHOWN = 6;
/** Open swaps listed per team */
const SWAPS_SHOWN = 3;

const pts = (v: number) => v.toFixed(1);
const players = (n: number) => `${n} player${n === 1 ? '' : 's'}`;

/** The card's line: what the side with work to do needs (null when there's nothing to say) */
export function needText(line: { need: number; players: number; expected: number; exact: boolean }, name: string): string {
  return line.exact
    ? `${name} needs ${pts(line.need)} from ${players(line.players)} (proj ${pts(line.expected)})`
    : `${name} needs about ${pts(line.need)} from ${players(line.players)} to be favored (proj ${pts(line.expected)})`;
}

interface Props {
  model: MatchupModel;
  /** The team shown on the left (the dialog puts mine there) */
  leftRosterId: number;
  names: Map<number, string>;
  matchups: SleeperMatchup[];
  projections: Record<string, LiveProjection>;
  games: Record<string, LiveGame>;
  slots: string[];
  defense: DefenseContext;
}

/**
 * The Live matchup dialog's "What each team needs": each team's target and its odds on a bad, typical
 * or great rest of the week, the players who swing it most, and lineup swaps still open. All from
 * the same model as the win odds (lib/analyze/whatItTakes.ts).
 */
export default function WhatItTakes({ model, leftRosterId, names, matchups, projections, games, slots, defense }: Props) {
  const left: SideKey = model.a.s.rosterId === leftRosterId ? 'a' : 'b';
  const sides: SideKey[] = [left, left === 'a' ? 'b' : 'a'];
  // Collapsed unless this viewer opened it
  const [open, setOpen] = useState(readOpen);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, String(next));
    } catch {
      // Not remembered (private browsing): it still toggles
    }
  };
  if (sides.every((k) => playersLeft(model[k]) === 0)) return null;
  const sideOdds = (k: SideKey) => (k === 'a' ? model.aWinOdds : 1 - model.aWinOdds);
  const name = (k: SideKey) => names.get(model[k].s.rosterId) ?? `Team ${model[k].s.rosterId}`;
  const player = (id: string) => {
    const p = projections[id];
    const game = p?.team ? games[p.team] : undefined;
    return { name: p?.name ?? id, position: p?.position ?? '', team: p?.team ?? '', game };
  };
  const heading = (
    <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wider text-[var(--muted)] [&::-webkit-details-marker]:hidden">
      What each team needs
      <span aria-hidden className={`inline-block text-sm transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
    </summary>
  );
  const box = 'mx-1.5 mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm';
  // Collapsed: just the heading, without working anything out
  if (!open) {
    return (
      <details className={box} aria-label="What each team needs" open={false} onToggle={(e) => e.currentTarget.open && toggle(true)}>
        {heading}
      </details>
    );
  }
  const swings = playerSwings(model).filter((s) => Math.abs(s.aSwing) >= 0.005).slice(0, SWINGS_SHOWN);
  const openSwaps = sides.map((k) => ({ k, list: swaps(model, k, matchups, projections, games, slots, defense).slice(0, SWAPS_SHOWN) }));

  return (
    <details className={box} aria-label="What each team needs" open onToggle={(e) => !e.currentTarget.open && toggle(false)}>
      {heading}

      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sides.map((k) => {
          const s = model[k];
          const n = playersLeft(s);
          if (n === 0) {
            return (
              <div key={k} className="min-w-0">
                <div className="truncate font-semibold text-[var(--foreground)]">{name(k)}</div>
                <p className="text-xs text-[var(--muted)]">Done: {pts(s.s.score)}</p>
              </div>
            );
          }
          const t = target(model, k)!;
          return (
            <div key={k} className="min-w-0">
              <div className="truncate font-semibold text-[var(--foreground)]">{name(k)}</div>
              <p className="text-[var(--foreground)]">
                {t.exact ? (
                  t.favored < 0 ? <>Already ahead: wins unless its players lose {pts(-t.favored)}</> : <>Needs <b>{pts(t.favored)}</b> to win</>
                ) : t.favored <= 0 ? (
                  <>Favored even if its players add nothing more</>
                ) : (
                  <>
                    Needs about <b>{pts(t.favored)}</b> to be favored
                    <span className="text-[var(--muted)]"> ({pts(Math.max(0, t.low))}–{pts(t.high)}, depending on the other side)</span>
                  </>
                )}
              </p>
              <p className="text-xs text-[var(--muted)]">from {players(n)} · projected to add {pts(expectedLeft(s))}</p>
              {t.exact ? (
                // The other side is done: the odds are just the chance of getting there
                <p className="mt-1.5 text-xs tabular-nums text-[var(--muted)]">
                  Chance of getting there:{' '}
                  <span className="font-semibold" style={{ color: sideOdds(k) >= 0.5 ? RESULT_DOT_COLORS.W : 'var(--foreground)' }}>{percent(sideOdds(k))}</span>
                  {' '}(typical {signed(outcomes(model, k)[1].adds)}, great day {signed(outcomes(model, k)[2].adds)})
                </p>
              ) : (
              <table className="mt-1.5 w-full text-xs tabular-nums">
                <tbody>
                  {outcomes(model, k).map((o) => (
                    <tr key={o.label}>
                      <td className="py-0.5 text-[var(--muted)]">{o.label}</td>
                      <td className="py-0.5 text-right text-[var(--foreground)]">{signed(o.adds)}</td>
                      <td className="w-14 py-0.5 text-right font-semibold" style={{ color: o.odds >= 0.5 ? RESULT_DOT_COLORS.W : 'var(--muted)' }}>
                        {percent(o.odds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
          );
        })}
      </div>

      {swings.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-[var(--muted)]">Who swings it most</h4>
          <ul className="mt-1 divide-y divide-[var(--border)]">
            {swings.map((s) => {
              const p = player(s.id);
              const note = gameScriptNote(p.position, p.game);
              const swing = Math.abs(s.aSwing);
              return (
                <li key={s.id} className="py-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-medium text-[var(--foreground)]">{p.name}</span>{' '}
                      <span className="text-xs text-[var(--muted)]">
                        {p.position} · {name(s.side)}
                        {p.game && ` · ${p.game.label}`}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--foreground)]" title="Win odds with a good rest of the game against a bad one">
                      ±{Math.round(swing * 100)}%
                    </span>
                  </div>
                  <div className="text-xs tabular-nums text-[var(--muted)]">
                    {signed(s.expected)} expected, usually {signed(s.low)} to {signed(s.high)}
                  </div>
                  {note && <div className="text-xs italic text-[var(--warning-text)]">{note}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {openSwaps.some((x) => x.list.length > 0) && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-[var(--muted)]">Lineup swaps still open</h4>
          <ul className="mt-1 space-y-1">
            {openSwaps.flatMap(({ k, list }) =>
              list.map((sw) => (
                <li key={`${k}${sw.slot}${sw.in}`} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-[var(--foreground)]">
                    {name(k)}: start <b>{player(sw.in).name}</b>
                    {sw.out !== '0' ? <> for {player(sw.out).name}</> : <> in the empty {slots[sw.slot]} slot</>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums">
                    <span className="text-[var(--muted)]">{percent(sw.before)} → </span>
                    <span className="font-semibold" style={{ color: RESULT_DOT_COLORS.W }}>{percent(sw.after)}</span>
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-[var(--muted)]">
        From the same model as the win odds. Ranges are each player&apos;s middle half of outcomes from 2020-2025&apos;s play by play
        (about a third of the time a player adds nothing more); swings are the win odds with a good rest of the game against a bad one.
        {openSwaps.some((x) => x.list.length > 0) && ' Swaps are for players whose games haven’t started, and mostly follow the projections.'}
      </p>
    </details>
  );
}
