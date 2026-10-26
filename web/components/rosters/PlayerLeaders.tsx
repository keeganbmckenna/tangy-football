'use client';

import { useMemo, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import { useMyTeam } from '@/hooks/useMyTeam';
import { POSITION_ORDER, playerLeaders, teamMvps } from '@/lib/analyze/rosters';
import { PlayerLabel, teamNames, type RostersCardProps } from './shared';

const SHOWN = 10;

/**
 * The season's top players by points scored in fantasy starting lineups (overall or by
 * position), the best single games, and each team's MVP
 */
export default function PlayerLeaders({ insights, teamStats }: RostersCardProps) {
  const me = useMyTeam();
  const [position, setPosition] = useState<string>('All');
  const { seasons, games } = useMemo(() => playerLeaders(insights), [insights]);
  const name = teamNames(teamStats);
  const pos = (id: string) => insights.players[id]?.position ?? '';
  const filter = <T extends { playerId: string }>(list: T[]) => (position === 'All' ? list : list.filter((x) => pos(x.playerId) === position));
  const top = filter(seasons).slice(0, SHOWN);
  const best = filter(games).slice(0, SHOWN);
  const mvps = [...teamMvps(seasons).entries()].map(([rosterId, mvp]) => ({ rosterId, mvp })).sort((a, b) => b.mvp.points - a.mvp.points);

  const list = (rows: Array<{ key: string; id: string; main: string; sub: string; mine: boolean }>) => (
    <ol className="divide-y divide-[var(--border)]">
      {rows.map((r, i) => (
        <li key={r.key} className="flex items-center gap-3 py-2">
          <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--muted)]">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[var(--foreground)]">
              <PlayerLabel insights={insights} id={r.id} /> <span className="text-xs text-[var(--muted)]">{pos(r.id)}</span>
            </div>
            <div className={`truncate text-xs ${r.mine ? 'font-semibold text-[var(--accent)]' : 'text-[var(--muted)]'}`}>{r.sub}</div>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--foreground)]">{r.main}</span>
        </li>
      ))}
    </ol>
  );

  return (
    <SectionCard
      title="Player Leaders"
      subtitle="Points scored in fantasy starting lineups"
      gradientType="secondary"
      footer={<span>Points count only while a player was in a fantasy starting lineup, for the team that started him. A team&apos;s MVP is its top scorer by those points.</span>}
    >
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Position">
          {['All', ...POSITION_ORDER].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPosition(p)}
              aria-pressed={position === p}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                position === p ? 'border-transparent bg-[var(--info-bg)] text-[var(--info-text)]' : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">Season</h3>
            {list(
              top.map((s) => ({
                key: s.playerId,
                id: s.playerId,
                main: s.started.toFixed(1),
                sub: `${s.rosters.map(name).join(', ')} · ${s.starts} start${s.starts === 1 ? '' : 's'}`,
                mine: s.rosters.includes(me.rosterId ?? -1),
              }))
            )}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">Single games</h3>
            {list(
              best.map((g) => ({
                key: `${g.playerId}-${g.week}-${g.rosterId}`,
                id: g.playerId,
                main: g.points.toFixed(1),
                sub: `Week ${g.week} · ${name(g.rosterId)}`,
                mine: g.rosterId === me.rosterId,
              }))
            )}
          </div>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-[var(--foreground)]">Team MVPs</h3>
          {list(
            mvps.map(({ rosterId, mvp }) => ({
              key: `mvp-${rosterId}`,
              id: mvp.playerId,
              main: mvp.points.toFixed(1),
              sub: name(rosterId),
              mine: rosterId === me.rosterId,
            }))
          )}
        </div>
      </div>
    </SectionCard>
  );
}
