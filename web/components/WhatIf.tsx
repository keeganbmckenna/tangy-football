'use client';

import { useMemo, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { formatRecord } from '@/lib/analyze/playEveryone';
import { formatOdds, simulatePlayoffOdds, type PlayoffOddsResponse } from '@/lib/analyze/playoffOdds';
import type { TeamStats } from '@/lib/types';
import { pointsChange } from '@/lib/format';

const SIMS = 10000;

/** The playoff simulation with some results fixed (the same seed every time, so runs compare cleanly) */
const simulate = (data: PlayoffOddsResponse, forced: Record<number, number>) =>
  data.model
    ? simulatePlayoffOdds(data.teams, data.model.remaining, data.format, data.model.meanByWeek, data.model.spread, SIMS, 2026, undefined, false, data.model.teamSpread, forced).teams
    : {};

interface WhatIfProps {
  data: PlayoffOddsResponse;
  teamStats: TeamStats[];
}

/**
 * Pick the winners of any remaining games and see everyone's playoff and bye odds with those
 * results fixed. The playoff simulation runs in the browser, with and without the picks on
 * the same random draws, so the change is the picks' effect rather than simulation noise.
 */
export default function WhatIf({ data, teamStats }: WhatIfProps) {
  const me = useMyTeam();
  const model = data.model;
  const weeks = useMemo(() => [...new Set(model?.remaining.map((g) => g.week) ?? [])].sort((a, b) => a - b), [model]);
  const [week, setWeek] = useState<number | null>(null);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const stats = new Map(teamStats.map((t) => [t.rosterId, t]));
  const name = (id: number) => stats.get(id)?.teamName ?? `Team ${id}`;

  const base = useMemo(() => simulate(data, {}), [data]);
  const picked = useMemo(() => simulate(data, picks), [data, picks]);
  if (!model || !weeks.length) return null;

  const shownWeek = week ?? weeks[0];
  // Each picked team's wins and losses from the picks
  const pickedRecord = new Map<number, { wins: number; losses: number }>();
  for (const [index, winner] of Object.entries(picks)) {
    const g = model.remaining[Number(index)];
    if (!g) continue;
    for (const id of [g.a, g.b]) {
      const r = pickedRecord.get(id) ?? { wins: 0, losses: 0 };
      if (id === winner) r.wins++;
      else r.losses++;
      pickedRecord.set(id, r);
    }
  }
  const pickCount = Object.keys(picks).length;
  const games = model.remaining.map((g, i) => ({ ...g, index: i })).filter((g) => g.week === shownWeek);
  const gameOdds = data.gameOdds ?? [];
  const rows = [...data.teams].sort((a, b) => (picked[b.rosterId]?.playoffs ?? 0) - (picked[a.rosterId]?.playoffs ?? 0) || (picked[b.rosterId]?.bye ?? 0) - (picked[a.rosterId]?.bye ?? 0));
  const toggle = (index: number, winner: number) =>
    setPicks((p) => {
      const next = { ...p };
      if (next[index] === winner) delete next[index];
      else next[index] = winner;
      return next;
    });
  const change = (now: number, then: number) => {
    const d = pointsChange(now, then);
    if (Math.abs(d) < 1) return null;
    return (
      <span className="ml-0.5 text-[10px] font-medium sm:ml-1 sm:text-xs" style={{ color: d > 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>
        {d > 0 ? '+' : '−'}
        {Math.abs(d)}
      </span>
    );
  };

  return (
    <SectionCard
      title="What If"
      subtitle="Pick winners and see what it does to everyone's odds"
      gradientType="accent"
      footer={
        <span>
          Games you don&apos;t pick are simulated as in the playoff odds ({SIMS.toLocaleString()} runs here). A picked team still scores
          what the model expects, so points tiebreakers stay realistic. Changes are in percentage points against the same
          simulation without your picks.
        </span>
      }
    >
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1" role="group" aria-label="Week">
            {weeks.map((w) => {
              const n = model.remaining.filter((g, i) => g.week === w && picks[i] !== undefined).length;
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeek(w)}
                  aria-pressed={shownWeek === w}
                  className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                    shownWeek === w
                      ? 'border-transparent bg-[var(--info-bg)] text-[var(--info-text)]'
                      : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  W{w}
                  {n > 0 && <span className="ml-1 text-[var(--accent)]">•{n}</span>}
                </button>
              );
            })}
          </div>
          {pickCount > 0 && (
            <button type="button" onClick={() => setPicks({})} className="text-xs font-semibold text-[var(--muted)] underline hover:text-[var(--foreground)]">
              Clear {pickCount} pick{pickCount === 1 ? '' : 's'}
            </button>
          )}
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {games.map((g) => {
            const odds = gameOdds[g.index]?.aWins;
            return (
              <li key={g.index} className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
                {[g.a, g.b].map((id) => {
                  const on = picks[g.index] === id;
                  const p = odds === undefined ? null : id === g.a ? odds : 1 - odds;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggle(g.index, id)}
                      aria-pressed={on}
                      className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-xs transition-colors sm:text-sm ${
                        on ? 'bg-[var(--success-bg)] text-[var(--success-text)]' : 'text-[var(--foreground)] hover:bg-[var(--neutral-bg)]'
                      } ${picks[g.index] !== undefined && !on ? 'opacity-50' : ''}`}
                    >
                      <div className="truncate font-medium">{name(id)}</div>
                      {p !== null && <div className="text-[10px] text-[var(--muted)] sm:text-xs">{formatOdds(p)} to win</div>}
                    </button>
                  );
                })}
              </li>
            );
          })}
        </ul>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-[var(--muted)]">
                <th className="py-2 pl-2.5 pr-2 text-left font-medium">Team</th>
                <th className="px-1.5 py-2 text-right font-medium sm:px-2">Playoffs</th>
                <th className="px-1.5 py-2 text-right font-medium sm:px-2">Bye</th>
                {data.format.hasDivisions && <th className="py-2 pl-1.5 text-right font-medium sm:pl-2">Div</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((t) => {
                const now = base[t.rosterId];
                const then = picked[t.rosterId];
                if (!now || !then) return null;
                return (
                  <tr key={t.rosterId} className={mineRow(t.rosterId === me.rosterId)}>
                    <td className="max-w-[7rem] py-2 pl-2.5 pr-1.5 text-[var(--foreground)] sm:max-w-none">
                      <div className="truncate" title={name(t.rosterId)}>{name(t.rosterId)}</div>
                      {/* The real record, and with picks for this team, the record they'd give */}
                      <div className="whitespace-nowrap text-xs tabular-nums text-[var(--muted)]">
                        {formatRecord(t.wins, t.losses, t.ties)}
                        {pickedRecord.has(t.rosterId) && (
                          <>
                            {' → '}
                            <span className="font-semibold text-[var(--foreground)]">
                              {formatRecord(t.wins + pickedRecord.get(t.rosterId)!.wins, t.losses + pickedRecord.get(t.rosterId)!.losses, t.ties)}
                            </span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 text-right sm:px-2 font-semibold tabular-nums text-[var(--foreground)]">
                      {formatOdds(then.playoffs)}
                      {change(now.playoffs, then.playoffs)}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 text-right sm:px-2 tabular-nums text-[var(--foreground)]">
                      {formatOdds(then.bye)}
                      {change(now.bye, then.bye)}
                    </td>
                    {data.format.hasDivisions && (
                      <td className="whitespace-nowrap py-2 pl-1.5 text-right sm:pl-2 tabular-nums text-[var(--foreground)]">
                        {formatOdds(then.division)}
                        {change(now.division, then.division)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}
