'use client';

import { Fragment, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import SectionCard from '@/components/ui/SectionCard';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import { useTableSort } from '@/hooks/useTableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { recordValue, sortRows } from '@/lib/tableSort';
import { CHART_THEME } from '@/lib/constants';
import { CLOSE_GAME_MARGIN } from '@/lib/analyze/luck';
import type { LifetimeLuck as LifetimeLuckData, LifetimeLuckRow, LifetimeLuckSeason } from '@/lib/analyze/lifetimeLuck';

// The same colors as the season's Schedule Luck Distribution
const ACTUAL_COLOR = '#f59e0b';
const SIM_COLOR = '#3b82f6';

const record = (r: { wins: number; losses: number; ties: number }) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`;
const wins = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}`;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const seasonLine = (s: LifetimeLuckSeason | null) => (s ? `${s.season} ${signed(s.luck)}` : '—');

interface Props {
  luck: LifetimeLuckData;
  nameOf: (userId: string) => string;
  onManager?: (userId: string) => void;
}

/** One manager's lifetime win totals over the shuffled schedules, their real total highlighted */
function Distribution({ row }: { row: LifetimeLuckRow }) {
  const data = row.outcomes.map((o) => ({ ...o, actual: o.wins === row.wins }));
  if (!data.some((d) => d.actual)) data.push({ wins: row.wins, frequency: 0, actual: true });
  data.sort((a, b) => a.wins - b.wins);
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
          <XAxis dataKey="wins" type="number" domain={['dataMin - 0.5', 'dataMax + 0.5']} allowDecimals={false} tickFormatter={wins} tick={{ fill: CHART_THEME.tick }} axisLine={{ stroke: CHART_THEME.axis }} tickLine={{ stroke: CHART_THEME.axis }} style={{ fontSize: '11px' }} />
          <YAxis tickFormatter={pct} tick={{ fill: CHART_THEME.tick }} axisLine={{ stroke: CHART_THEME.axis }} tickLine={{ stroke: CHART_THEME.axis }} width={40} style={{ fontSize: '11px' }} />
          <ReferenceLine x={row.expected} stroke={CHART_THEME.axis} strokeDasharray="4 3" />
          <Tooltip
            isAnimationActive={false}
            cursor={{ fill: CHART_THEME.cursor }}
            content={({ active, payload }) => {
              const d = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !d) return null;
              return (
                <div className="rounded-lg border-2 border-[var(--chart-tooltip-border)] bg-[var(--chart-tooltip-bg)] p-3 shadow-lg">
                  <p className="mb-1 font-bold text-[var(--chart-tooltip-text)]">{wins(d.wins)} wins{d.actual ? ' (what happened)' : ''}</p>
                  <p className="text-sm text-[var(--chart-tooltip-muted)]">{(d.frequency * 100).toFixed(1)}% of schedules</p>
                </div>
              );
            }}
          />
          <Bar isAnimationActive={false} dataKey="frequency" minPointSize={1} radius={[2, 2, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.wins} fill={d.actual ? ACTUAL_COLOR : d.frequency === 0 ? 'transparent' : SIM_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Lifetime Luck (History tab, lib/analyze/lifetimeLuck.ts): every manager's Sleeper-era
 * regular-season wins against the range their scoring would have won on other schedules. Each row's
 * bar is that range (the middle 80%) centered on what was expected, the dot what happened; tap a row
 * for the whole distribution.
 */
export default function LifetimeLuck({ luck, nameOf, onManager }: Props) {
  const sort = useTableSort('lifetimeLuck');
  const me = useMyTeam();
  const [open, setOpen] = useState<string | null>(null);
  if (!luck.rows.length) return null;

  // One scale for every bar: wins over (or under) expected
  const reach = Math.max(
    1,
    ...luck.rows.flatMap((r) => [Math.abs(r.range[0] - r.expected), Math.abs(r.range[1] - r.expected), Math.abs(r.luck)])
  );
  const scale = Math.ceil(reach);
  const at = (x: number) => `${50 + (x / scale) * 50}%`;
  // Chance alone over a full run of seasons, for scale
  const full = luck.rows.filter((r) => r.seasons.length === luck.seasons.length);
  const spread = full.length ? full.reduce((s, r) => s + (r.range[1] - r.range[0]) / 2, 0) / full.length : null;
  const years = [...luck.seasons].sort();
  const rows = sortRows(luck.rows, sort.state, (r, key) =>
    ({
      luck: r.luck,
      percentile: r.percentile,
      record: recordValue(r.record.wins, r.record.losses, r.record.ties),
      expected: r.expected,
      close: recordValue(r.close.wins, r.close.losses, r.close.ties),
      seasons: r.seasons.length,
    })[key]
  );
  const th = 'px-3 py-3 text-center font-medium';

  return (
    <SectionCard
      title="Lifetime Luck"
      subtitle={`Regular-season wins against what each manager's scoring would have won on ${luck.simulations.toLocaleString()} shuffled schedules a season, ${years[0]}–${years[years.length - 1]}. Tap a row for the full range.`}
      gradientType="warning"
    >
      <SortStatus sort={sort} />
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
              <th className={`${PIN_TH} py-3 font-medium bg-[var(--surface-elevated)]`}>Manager</th>
              <SortableTh sort={sort} col="luck" label="Wins over expected" tip="Real wins minus the average over shuffled schedules. The bar is the middle 80% of schedules, the dot what happened." className="px-3 py-3 font-medium">
                <span className="whitespace-nowrap">Luck <span className="normal-case tracking-normal">(wins)</span></span>
              </SortableTh>
              <SortableTh sort={sort} col="percentile" label="Luckier than" tip="Share of shuffled schedules that would have given fewer wins" className={th}>Luckier than</SortableTh>
              <SortableTh sort={sort} col="record" className={`hidden sm:table-cell ${th}`}>Record</SortableTh>
              <SortableTh sort={sort} col="expected" label="Expected wins" className={`hidden sm:table-cell ${th}`}>Expected</SortableTh>
              <SortableTh sort={sort} col="close" tip={`Record in games decided by under ${CLOSE_GAME_MARGIN} points: luck, not clutch`} className={`hidden md:table-cell ${th}`}>Close</SortableTh>
              <th className={`hidden lg:table-cell ${th}`}>Luckiest season</th>
              <th className={`hidden lg:table-cell ${th}`}>Unluckiest season</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((r) => {
              const isOpen = open === r.userId;
              const toggle = () => setOpen(isOpen ? null : r.userId);
              return (
                <Fragment key={r.userId}>
                  <tr className={`cursor-pointer hover:bg-[var(--hover)] ${mineRow(r.userId === me.userId)}`} onClick={toggle}>
                    <td className={`${PIN_TD} py-2 bg-[var(--surface-elevated)]`}>
                      {onManager ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onManager(r.userId);
                          }}
                          className="block max-w-[6.5rem] truncate text-left font-medium text-[var(--foreground)] hover:underline sm:max-w-none"
                          title={`${nameOf(r.userId)}: see their page`}
                        >
                          {nameOf(r.userId)}
                        </button>
                      ) : (
                        <span className="font-medium text-[var(--foreground)]">{nameOf(r.userId)}</span>
                      )}
                      <span className="block text-xs text-[var(--muted)]">{r.seasons.length} season{r.seasons.length === 1 ? '' : 's'}</span>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle();
                        }}
                        className="flex w-full min-w-[9rem] items-center gap-2 text-left"
                        title={`Middle 80% of schedules: ${wins(r.range[0])}–${wins(r.range[1])} wins (expected ${r.expected.toFixed(1)}); real ${wins(r.wins)}`}
                      >
                        <span className="relative h-4 flex-1" aria-hidden>
                          <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--border)]" />
                          <span
                            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
                            style={{ left: at(r.range[0] - r.expected), right: `calc(100% - ${at(r.range[1] - r.expected)})`, backgroundColor: SIM_COLOR, opacity: 0.35 }}
                          />
                          <span
                            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface-elevated)]"
                            style={{ left: at(r.luck), backgroundColor: ACTUAL_COLOR }}
                          />
                        </span>
                        <span className="w-10 shrink-0 text-right font-semibold tabular-nums text-[var(--foreground)]">{signed(r.luck)}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-[var(--foreground)]">{pct(r.percentile)}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-center tabular-nums text-[var(--foreground)]">{record(r.record)}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-center tabular-nums text-[var(--foreground)]">{r.expected.toFixed(1)}</td>
                    <td className="hidden md:table-cell px-3 py-2 text-center tabular-nums text-[var(--foreground)]">{record(r.close)}</td>
                    <td className="hidden lg:table-cell px-3 py-2 text-center tabular-nums text-[var(--foreground)]">{seasonLine(r.luckiest)}</td>
                    <td className="hidden lg:table-cell px-3 py-2 text-center tabular-nums text-[var(--foreground)]">{seasonLine(r.unluckiest)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={8} className="bg-[var(--surface)] px-4 py-3">
                        <div className="sticky left-4 max-w-[calc(100vw-4rem)] space-y-3 sm:max-w-none">
                          <p className="text-xs text-[var(--muted)]">
                            {nameOf(r.userId)} won <span className="font-semibold text-[var(--foreground)]">{wins(r.wins)}</span> regular-season games ({record(r.record)});
                            their scoring would have won {r.expected.toFixed(1)} on average, and {wins(r.range[0])}–{wins(r.range[1])} on 80% of schedules.
                            Close games (under {CLOSE_GAME_MARGIN} points): {record(r.close)}.
                          </p>
                          <Distribution row={r} />
                          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                            {r.seasons.map((s) => (
                              <li key={s.season}>
                                {s.season}: <span className="text-[var(--foreground)]">{wins(s.wins)}</span> wins, expected {s.expected.toFixed(1)}{' '}
                                <span className="font-semibold text-[var(--foreground)]">({signed(s.luck)})</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-[var(--muted)]">
        Each season keeps every team&apos;s real weekly scores and reshuffles who played whom, as the season&apos;s Schedule Luck chart does;
        a manager&apos;s seasons then add up. Bars share one scale ({`±${scale}`} wins); the line is expected.
        {spread !== null && ` Over ${luck.seasons.length} seasons, schedules alone swing a manager about ±${spread.toFixed(1)} wins on 80% of them.`}{' '}
        Before {years[0]} only final standings were kept, so those seasons can&apos;t be reshuffled
        {luck.inProgress && `; ${luck.inProgress} counts its finished weeks`}. Ties count as half a win.
        Luck doesn&apos;t carry over: a manager&apos;s luck one half of a season says nothing about the next.
      </p>
    </SectionCard>
  );
}
