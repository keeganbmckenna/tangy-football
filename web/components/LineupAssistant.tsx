'use client';

import { useMemo, useState } from 'react';
import { useMyTeam } from '@/hooks/useMyTeam';
import SectionCard from '@/components/ui/SectionCard';
import { lineupAdvice } from '@/lib/analyze/lineupAssistant';
import type { TradeDataResponse } from '@/lib/analyze/trade';
import type { TeamStats } from '@/lib/types';

interface LineupAssistantProps {
  data: TradeDataResponse;
  teamStats: TeamStats[];
}

const pts = (n: number) => n.toFixed(1);

/** Your team for the coming week: the lineup set in Sleeper against the best one by projections, as swaps */
export default function LineupAssistant({ data, teamStats }: LineupAssistantProps) {
  const myTeam = useMyTeam();
  const [me, setMe] = useState<number | null>(myTeam.rosterId);
  const { inputs, setLineups } = data;
  const week = setLineups?.week ?? null;

  const name = (id: string) => data.players[id]?.name ?? id;
  const pos = (id: string) => data.players[id]?.position ?? inputs.positions[id] ?? '';
  const weekPts = (id: string) => (week === null ? 0 : inputs.projections[id]?.[week] ?? 0);

  const lineup = useMemo(
    () => (me === null || !setLineups ? null : lineupAdvice(inputs, me, setLineups.starters[me] ?? [], setLineups.week)),
    [inputs, me, setLineups]
  );
  if (!setLineups) return null;
  const gain = lineup ? lineup.bestTotal - lineup.setTotal : 0;

  return (
    <SectionCard
      title="Lineup Assistant"
      subtitle="Your best lineup for the coming week, against the one you’ve set in Sleeper."
      gradientType="success"
      footer={
        <div className="space-y-2">
          <p>
            Projections are the same as the trade tools use: Sleeper’s projection for the week blended with each player’s
            season so far. A player on bye or out is projected for 0. Sleeper locks a player once his game kicks off, so
            later in the week only the swaps for games still to come can be made.
          </p>
        </div>
      }
    >
      <div className="space-y-5 p-4 sm:p-6">
        <div>
          <label className="sr-only" htmlFor="lineup-team">Your team</label>
          <select
            id="lineup-team"
            value={me ?? ''}
            onChange={(e) => setMe(e.target.value ? Number(e.target.value) : null)}
            className="min-w-[12rem] rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--foreground)]"
          >
            <option value="">Choose your team</option>
            {[...teamStats]
              .sort((x, y) => x.username.localeCompare(y.username, undefined, { sensitivity: 'base' }))
              .map((t) => (
                <option key={t.rosterId} value={t.rosterId}>
                  {t.username}
                </option>
              ))}
          </select>
        </div>

        {me !== null && lineup && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Week {lineup.week}</h3>
              <p className="text-sm text-[var(--muted)]">
                Your lineup: <span className="font-semibold text-[var(--foreground)]">{pts(lineup.setTotal)}</span> projected
                {gain > 0.05 && (
                  <>
                    {' '}· best: <span className="font-semibold text-[var(--foreground)]">{pts(lineup.bestTotal)}</span>{' '}
                    <span className="font-semibold text-[var(--success-text)]">+{pts(gain)}</span>
                  </>
                )}
              </p>
            </div>
            {lineup.swaps.length === 0 ? (
              <p className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm text-[var(--foreground)]">
                <span className="mr-1 font-semibold text-[var(--success-text)]">✓</span>
                Your best lineup is set.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                {lineup.swaps.map((s) => (
                  <li key={s.start} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="text-[var(--muted)]">Start </span>
                      <span className="font-semibold text-[var(--foreground)]">{name(s.start)}</span>
                      <span className="text-xs text-[var(--muted)]"> {pos(s.start)} · {pts(weekPts(s.start))}</span>
                      <span className="block sm:inline">
                        <span className="text-[var(--muted)]">{s.sit ? <> {' '}over </> : ' '}</span>
                        {s.sit ? (
                          <>
                            <span className="font-semibold text-[var(--foreground)]">{name(s.sit)}</span>
                            <span className="text-xs text-[var(--muted)]"> {pos(s.sit)} · {pts(weekPts(s.sit))}</span>
                          </>
                        ) : (
                          <span className="text-[var(--muted)]">in an empty slot</span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-[var(--success-text)]">+{pts(s.gain)}</span>
                  </li>
                ))}
              </ul>
            )}
            {(lineup.zeros.length > 0 || lineup.emptySlots > 0) && (
              <p className="text-sm text-[var(--danger-text)]">
                {lineup.emptySlots > 0 && `${lineup.emptySlots} starting slot${lineup.emptySlots === 1 ? ' is' : 's are'} empty. `}
                {lineup.zeros.length > 0 &&
                  `Projected for 0 (out or on bye): ${lineup.zeros.map((p) => `${name(p)}${data.players[p]?.injury ? ` (${data.players[p].injury})` : ''}`).join(', ')}.`}
              </p>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
