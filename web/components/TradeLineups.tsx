'use client';

import { bestLineup } from '@/lib/analyze/playoffOdds';
import type { RosterChange, TradeInputs, TradePlayerInfo } from '@/lib/analyze/trade';

const NON_STARTING = new Set(['BN', 'IR', 'TAXI']);
const SLOT_LABEL: Record<string, string> = { SUPER_FLEX: 'SF', REC_FLEX: 'FLEX', WRRB_FLEX: 'FLEX' };

/** "J. Williams" on phones; defenses keep their name */
const shortName = (p: TradePlayerInfo | undefined, id: string) =>
  !p ? id : p.position === 'DEF' ? p.name.split(' ').slice(-1)[0] : p.name.replace(/^(\S)\S*\s+(?=\S)/, '$1. ');

interface Entry {
  id: string;
  points: number;
}

interface Lineup {
  starters: Array<{ slot: string; entry: Entry | null }>;
  bench: Entry[];
}

/** A roster's best lineup for one week, in the league's slot order, and its bench by expected points */
function lineupFor(inputs: TradeInputs, players: string[], reserve: Set<string>, week: number): Lineup {
  const active = players.filter((p) => !reserve.has(p));
  const proj = Object.fromEntries(
    active.filter((p) => inputs.positions[p]).map((p) => [p, { position: inputs.positions[p], points: inputs.projections[p]?.[week] ?? 0 }])
  );
  const { starters } = bestLineup(active, proj, inputs.rosterPositions);
  const left = [...starters];
  const ordered = inputs.rosterPositions
    .filter((s) => !NON_STARTING.has(s))
    .map((slot) => {
      const i = left.findIndex((s) => s.slot === slot);
      const s = i === -1 ? null : left.splice(i, 1)[0];
      return { slot, entry: s ? { id: s.playerId, points: s.points } : null };
    });
  const starting = new Set(starters.map((s) => s.playerId));
  const bench = active
    .filter((p) => !starting.has(p))
    .map((id) => ({ id, points: proj[id]?.points ?? 0 }))
    .sort((a, b) => b.points - a.points);
  return { starters: ordered, bench };
}

/** Each team's lineup and bench for a week, without the trade and with it */
export default function TradeLineups({
  inputs,
  players,
  change,
  week,
  name,
  color,
}: {
  inputs: TradeInputs;
  players: Record<string, TradePlayerInfo>;
  change: RosterChange;
  week: number;
  name: string;
  color: string;
}) {
  const reserve = new Set(inputs.reserve?.[change.rosterId] ?? []);
  const before = lineupFor(inputs, change.before, reserve, week);
  const after = lineupFor(inputs, change.after, reserve, week);
  const leaving = new Set(change.before.filter((p) => !change.after.includes(p)));
  const arriving = new Set(change.after.filter((p) => !change.before.includes(p)));
  const dropped = new Set(change.dropped);
  const added = new Set(change.added);
  const total = (l: Lineup) => l.starters.reduce((s, x) => s + (x.entry?.points ?? 0), 0);
  const ir = change.after.filter((p) => reserve.has(p));

  const cell = (e: Entry | null | undefined, side: 'before' | 'after') => {
    if (!e) return <td className="px-2 py-1.5 text-[var(--muted)]">{e === null ? 'Empty' : ''}</td>;
    const p = players[e.id];
    const moving = side === 'before' ? leaving.has(e.id) : arriving.has(e.id);
    const tag = side === 'before' ? (dropped.has(e.id) ? 'dropped' : 'traded') : added.has(e.id) ? 'free agent' : 'new';
    const pts = e.points > 0 ? e.points.toFixed(1) : p?.byeWeek === week ? 'bye' : 'out';
    return (
      <td className="px-2 py-1.5" style={moving && side === 'after' ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
        <div className="flex items-baseline justify-between gap-2">
          <span className={`min-w-0 truncate ${moving && side === 'before' ? 'text-[var(--muted)] line-through' : 'text-[var(--foreground)]'} ${moving && side === 'after' ? 'font-semibold' : ''}`} title={p?.name ?? e.id}>
            <span className="sm:hidden">{shortName(p, e.id)}</span>
            <span className="hidden sm:inline">{p?.name ?? e.id}</span>
          </span>
          <span className="shrink-0 tabular-nums text-xs text-[var(--muted)]">{pts}</span>
        </div>
        <div className="text-[11px] text-[var(--muted)]">
          {p?.position}
          {p?.team ? ` · ${p.team}` : ''}
          {moving && <span className="ml-1 font-semibold" style={side === 'after' ? { color } : undefined}>{tag}</span>}
        </div>
      </td>
    );
  };

  const benchRows = Math.max(before.bench.length, after.bench.length);
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)]">
      <div className="border-b border-[var(--border)] px-3 py-2 text-sm font-semibold" style={{ color }}>
        {name}
      </div>
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-11" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
            <th className="px-2 py-1.5 font-medium" />
            <th className="px-2 py-1.5 font-medium">Before</th>
            <th className="px-2 py-1.5 font-medium">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {before.starters.map((s, i) => (
            <tr key={`s${i}`}>
              <td className="px-2 py-1.5 text-xs font-medium text-[var(--muted)]">{SLOT_LABEL[s.slot] ?? s.slot}</td>
              {cell(s.entry, 'before')}
              {cell(after.starters[i]?.entry ?? null, 'after')}
            </tr>
          ))}
          <tr className="bg-[var(--surface)] font-semibold">
            <td className="px-2 py-1.5 text-xs font-medium text-[var(--muted)]">Total</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-[var(--foreground)]">{total(before).toFixed(1)}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-[var(--foreground)]">{total(after).toFixed(1)}</td>
          </tr>
          {Array.from({ length: benchRows }, (_, i) => (
            <tr key={`b${i}`}>
              <td className="px-2 py-1.5 text-xs font-medium text-[var(--muted)]">BN</td>
              {cell(before.bench[i], 'before')}
              {cell(after.bench[i], 'after')}
            </tr>
          ))}
          {ir.map((id) => (
            <tr key={`ir${id}`}>
              <td className="px-2 py-1.5 text-xs font-medium text-[var(--muted)]">IR</td>
              {cell({ id, points: 0 }, 'before')}
              {cell({ id, points: 0 }, 'after')}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
