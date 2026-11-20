'use client';

import type { ReactNode } from 'react';
import type { LineupWeek } from '@/lib/analyze/trade';
import { signed } from '@/lib/format';

const tone = (d: number) => (Math.abs(d) < 0.05 ? 'var(--muted)' : d > 0 ? 'var(--success-text)' : 'var(--danger-text)');

/**
 * A move's projected lineup change, folded away under its summary line: each remaining week's best
 * lineup without and with it, so a bye or one big week behind the average shows. The average (the
 * figure the odds use) is over the regular-season weeks; playoff weeks are listed after it.
 */
export default function LineupWeeks({ rows, summary }: { rows: LineupWeek[]; summary: ReactNode }) {
  const regular = rows.filter((r) => !r.playoffs);
  // Consecutive playoff weeks with the same lineups (projections carried forward) as one row
  const playoffs: Array<LineupWeek & { last: number }> = [];
  for (const r of rows.filter((x) => x.playoffs)) {
    const prev = playoffs[playoffs.length - 1];
    if (prev && prev.last === r.week - 1 && prev.before === r.before && prev.after === r.after) prev.last = r.week;
    else playoffs.push({ ...r, last: r.week });
  }
  const mean = (f: (r: LineupWeek) => number) => (regular.length ? regular.reduce((s, r) => s + f(r), 0) / regular.length : 0);
  const row = (key: string, label: ReactNode, before: number, after: number, strong = false) => {
    const d = after - before;
    return (
      <tr key={key} className={strong ? 'border-t border-[var(--border)] font-semibold' : ''}>
        <td className="py-0.5 pr-3 text-left text-[var(--muted)]">{label}</td>
        <td className="px-2 py-0.5 text-right text-[var(--muted)]">{before.toFixed(1)}</td>
        <td className="px-2 py-0.5 text-right text-[var(--foreground)]">{after.toFixed(1)}</td>
        <td className="py-0.5 pl-2 text-right font-semibold" style={{ color: tone(d) }}>
          {signed(d)}
        </td>
      </tr>
    );
  };
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
      </summary>
      <table className="mt-1 text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
            <th className="pr-3 text-left font-medium">Week</th>
            <th className="px-2 text-right font-medium">Without</th>
            <th className="px-2 text-right font-medium">With</th>
            <th className="pl-2 text-right font-medium">+/−</th>
          </tr>
        </thead>
        <tbody>
          {regular.map((r) => row(String(r.week), r.week, r.before, r.after))}
          {regular.length > 1 && row('avg', 'Avg', mean((r) => r.before), mean((r) => r.after), true)}
          {playoffs.map((r) => row(String(r.week), `${r.week}${r.last > r.week ? `–${r.last}` : ''} (playoffs)`, r.before, r.after))}
        </tbody>
      </table>
    </details>
  );
}
