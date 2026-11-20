'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import TradeLineups from '@/components/TradeLineups';
import { CHART_THEME } from '@/lib/constants';
import { bestLineup, formatOdds, type OddsResult, type TeamOdds } from '@/lib/analyze/playoffOdds';
import { lineupByWeek, weeklyOutlook, type RosterChange, type TradeDataResponse, type TradeModel } from '@/lib/analyze/trade';
import type { TeamStats } from '@/lib/types';
import { signed } from '@/lib/format';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';

/** One team a move changes: its roster before and after (as shown), and what it sent away */
export interface ImpactSide {
  rosterId: number;
  name: string;
  color: string;
  change: RosterChange;
  /** Players it traded away and got in the trade (none for pickups) */
  sent: string[];
  received: string[];
  /** More for its summary card (e.g. market value) */
  extra?: ReactNode;
}

// ---------------------------------------------------------------------------
// Formatting

/** Change in percentage points; changes under half a point are within the model's precision */
function OddsChange({ before, after, bad = false }: { before: number; after: number; bad?: boolean }) {
  const d = (after - before) * 100;
  if (Math.abs(d) < 0.5) return <span className="text-[var(--muted)]">~0</span>;
  const good = bad ? d < 0 : d > 0;
  return (
    <span className="font-semibold" style={{ color: good ? 'var(--success-text)' : 'var(--danger-text)' }}>
      {signed(d, Math.abs(d) < 10 ? 1 : 0)}
    </span>
  );
}

export function BeforeAfter({ before, after, bad = false }: { before: number; after: number; bad?: boolean }) {
  return (
    <span>
      <span className="whitespace-nowrap">
        <span className="text-[var(--muted)]">{formatOdds(before)}</span>
        <span className="mx-1 text-[var(--muted)]">→</span>
        <span className="font-semibold text-[var(--foreground)]">{formatOdds(after)}</span>
      </span>
      <span className="block text-xs sm:ml-2 sm:inline">
        (<OddsChange before={before} after={after} bad={bad} />)
      </span>
    </span>
  );
}

export function WinsChange({ before, after }: { before: number; after: number }) {
  const d = after - before;
  return (
    <span>
      <span className="whitespace-nowrap">
        <span className="text-[var(--muted)]">{before.toFixed(1)}</span>
        <span className="mx-1 text-[var(--muted)]">→</span>
        <span className="font-semibold text-[var(--foreground)]">{after.toFixed(1)}</span>
      </span>
      <span className="block text-xs sm:ml-2 sm:inline">
        (
        {Math.abs(d) < 0.05 ? (
          <span className="text-[var(--muted)]">~0</span>
        ) : (
          <span className="font-semibold" style={{ color: d > 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>
            {signed(d)}
          </span>
        )}
        )
      </span>
    </span>
  );
}

const Simulating = () => <span className="text-xs text-[var(--muted)]">Simulating…</span>;

// ---------------------------------------------------------------------------
// Weekly win odds chart

type ChartRow = { week: number } & Record<string, number | string | undefined>;

function LegendItem({ color, dashed, label }: { color: string; dashed: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-[var(--chart-legend)]">
      <svg width="28" height="10" aria-hidden>
        <line x1="1" y1="5" x2="27" y2="5" stroke={color} strokeWidth={2.5} strokeDasharray={dashed ? '5 4' : undefined} strokeOpacity={dashed ? 0.55 : 1} />
        <circle cx="14" cy="5" r="3.5" fill={dashed ? 'var(--surface-elevated)' : color} stroke={color} strokeWidth={2} strokeOpacity={dashed ? 0.55 : 1} />
      </svg>
      {label}
    </span>
  );
}

function WinOddsChart({ rows, sides }: { rows: ChartRow[]; sides: ImpactSide[] }) {
  const pctLabel = (v: unknown) => (typeof v !== 'number' ? '—' : `${Math.round(v)}%`);
  const tap = useTapTooltip()();
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
        {sides.flatMap((s, i) => [
          <LegendItem key={`${i}a`} color={s.color} dashed={false} label={sides.length > 1 ? `${s.name} after` : 'After'} />,
          <LegendItem key={`${i}b`} color={s.color} dashed label={sides.length > 1 ? `${s.name} before` : 'Before'} />,
        ])}
      </div>
      <ResponsiveContainer width="100%" height={sides.length > 1 ? 300 : 240}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: -8 }} {...tap.chartProps}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
          <XAxis dataKey="week" tickFormatter={(w) => `W${w}`} tick={{ fill: CHART_THEME.tick, fontSize: 12 }} axisLine={{ stroke: CHART_THEME.axis }} tickLine={{ stroke: CHART_THEME.axis }} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: CHART_THEME.tick, fontSize: 12 }} axisLine={{ stroke: CHART_THEME.axis }} tickLine={{ stroke: CHART_THEME.axis }} />
          <ReferenceLine y={50} stroke={CHART_THEME.axis} strokeDasharray="2 4" />
          <Tooltip
            isAnimationActive={false}
            active={tap.active}
            cursor={{ stroke: CHART_THEME.axis, strokeWidth: 1 }}
            wrapperStyle={{ maxWidth: 260 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as ChartRow;
              return (
                <div className="rounded-lg border px-3 py-2 text-xs shadow-lg" style={{ backgroundColor: CHART_THEME.tooltipBg, borderColor: CHART_THEME.tooltipBorder, color: CHART_THEME.tooltipText }}>
                  <div className="mb-1 font-semibold">Week {r.week}</div>
                  {sides.map((s, i) =>
                    r[`s${i}Before`] === undefined ? null : (
                      <div key={i} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                        <span>
                          {sides.length > 1 ? `${s.name} ` : ''}vs {r[`s${i}Opponent`]}: {pctLabel(r[`s${i}Before`])} → <strong>{pctLabel(r[`s${i}After`])}</strong>
                        </span>
                      </div>
                    )
                  )}
                  {sides.length > 1 && r.s0Opponent === sides[1].name && <div className="mt-1" style={{ color: CHART_THEME.tooltipMuted }}>They play each other this week</div>}
                </div>
              );
            }}
          />
          {sides.flatMap((s, i) => [
            <Line key={`${i}Before`} dataKey={`s${i}Before`} stroke={s.color} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 4, fill: 'var(--surface-elevated)', stroke: s.color, strokeWidth: 2, strokeOpacity: 0.55 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />,
            <Line key={`${i}After`} dataKey={`s${i}After`} stroke={s.color} strokeWidth={2.5} dot={{ r: 4, fill: s.color, stroke: 'var(--surface-elevated)', strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls isAnimationActive={false} />,
          ])}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The impact

interface SeasonRow {
  label: string;
  get: (t: TeamOdds) => number | null;
  bad?: boolean;
}

/**
 * What a move (a trade, or waiver pickups) does: each changed team's win odds week by week, its
 * season odds, its lineup, and the other teams whose odds move. Before and after are two models of
 * the league with their simulated odds (null while simulating).
 */
export default function MoveImpact({
  data,
  teamStats,
  sides,
  before,
  after,
  beforeLabel,
  children,
}: {
  data: TradeDataResponse;
  teamStats: TeamStats[];
  sides: ImpactSide[];
  before: { model: TradeModel; odds: OddsResult | null };
  after: { model: TradeModel; odds: OddsResult | null };
  /** What "before" is: "without the trade", "with the best pickups instead" */
  beforeLabel: string;
  /** Rest of How this works */
  children?: ReactNode;
}) {
  const { inputs } = data;
  const me = useMyTeam();
  const name = (id: number) => teamStats.find((t) => t.rosterId === id)?.username.trim() ?? `Team ${id}`;
  const firstWeek = data.remaining.reduce((m, g) => Math.min(m, g.week), Infinity);
  const [lineupWeek, setLineupWeek] = useState<number | null>(null);
  const shownWeek = lineupWeek !== null && inputs.weeks.includes(lineupWeek) ? lineupWeek : Number.isFinite(firstWeek) ? firstWeek : inputs.weeks[0];
  const playerName = (id: string) => data.players[id]?.name ?? id;
  const ids = sides.map((s) => s.rosterId);

  const rows: ChartRow[] = useMemo(() => {
    const out = new Map<number, ChartRow>();
    const row = (w: number) => out.get(w) ?? out.set(w, { week: w }).get(w)!;
    sides.forEach((s, i) => {
      for (const [key, m] of [['Before', before.model], ['After', after.model]] as const) {
        for (const o of weeklyOutlook(s.rosterId, data.remaining, m)) {
          const r = row(o.week);
          r[`s${i}${key}`] = Math.round(o.winProbability * 1000) / 10;
          r[`s${i}Opponent`] = name(o.opponent);
        }
      }
    });
    return [...out.values()].sort((x, y) => x.week - y.week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sides, before.model, after.model, data, teamStats]);

  const first = before.odds ? Object.values(before.odds.teams)[0] : null;
  const seasonRows: SeasonRow[] = [
    { label: 'Make the playoffs', get: (t) => t.playoffs },
    ...(data.format.hasDivisions ? [{ label: 'Win the division', get: (t: TeamOdds) => t.division }] : []),
    { label: 'Playoff bye', get: (t) => t.bye },
    ...(first?.champion !== null ? [{ label: 'Win the league', get: (t: TeamOdds) => t.champion }] : []),
    ...(data.hasToiletBowl
      ? [
          { label: 'Toilet bowl bye', get: (t: TeamOdds) => t.toiletBye, bad: true },
          { label: 'Lose the toilet bowl', get: (t: TeamOdds) => t.lastPlace, bad: true },
        ]
      : []),
  ];

  const lineupSummary = (change: RosterChange) => {
    const regular = inputs.weeks.filter((w) => w <= data.regularSeasonEnd);
    const avg = (players: string[]) => {
      const byWeek = lineupByWeek(inputs, players);
      return regular.length ? regular.reduce((s, w) => s + byWeek[w], 0) / regular.length : 0;
    };
    const proj = (players: string[]) =>
      Object.fromEntries(players.filter((p) => inputs.positions[p]).map((p) => [p, { position: inputs.positions[p], points: inputs.projections[p]?.[firstWeek] ?? 0 }]));
    const startersBefore = bestLineup(change.before, proj(change.before), inputs.rosterPositions).starters;
    const startersAfter = bestLineup(change.after, proj(change.after), inputs.rosterPositions).starters;
    const set = (s: typeof startersBefore) => new Set(s.map((x) => x.playerId));
    const b = set(startersBefore);
    const a = set(startersAfter);
    return {
      before: avg(change.before),
      after: avg(change.after),
      in: startersAfter.filter((s) => !b.has(s.playerId)),
      out: startersBefore.filter((s) => !a.has(s.playerId)),
    };
  };

  const ripple =
    before.odds && after.odds
      ? data.teams
          .filter((t) => !ids.includes(t.rosterId))
          .map((t) => ({ id: t.rosterId, b: before.odds!.teams[t.rosterId], a: after.odds!.teams[t.rosterId] }))
          .filter(({ a, b }) => [a.playoffs - b.playoffs, (a.champion ?? 0) - (b.champion ?? 0), (a.lastPlace ?? 0) - (b.lastPlace ?? 0)].some((d) => Math.abs(d) >= 0.005))
          .sort((x, y) => Math.abs(y.a.playoffs - y.b.playoffs) - Math.abs(x.a.playoffs - x.b.playoffs))
      : [];

  // You, when you're not one of the teams the move changes
  const myRoster = me.rosterId ?? undefined;
  const mine =
    myRoster !== undefined && !ids.includes(myRoster) && before.odds?.teams[myRoster] && after.odds?.teams[myRoster]
      ? { id: myRoster, b: before.odds.teams[myRoster], a: after.odds.teams[myRoster] }
      : null;
  const one = sides.length === 1;
  return (
    <>
      <div>
        <h3 className="text-lg font-semibold text-[var(--foreground)]">Win odds each week</h3>
        <p className="mb-3 text-sm text-[var(--muted)]">
          {one ? 'Your' : 'Each team’s'} chance to win {one ? 'each' : 'its'} game, {beforeLabel} (dashed) and with it (solid). Games more than a week away are less certain: next week&apos;s lineup says much less about them.
        </p>
        <WinOddsChart rows={rows} sides={sides} />
      </div>

      <div>
        <h3 className="text-lg font-semibold text-[var(--foreground)]">Season outlook</h3>
        <p className="mb-3 text-sm text-[var(--muted)]">Before → after, with the change in percentage points. Changes under half a point are shown as ~0.</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                <th className="w-[38%] px-3 py-2 font-medium" />
                {sides.map((s) => (
                  <th key={s.rosterId} className="px-3 py-2 font-medium" style={{ color: s.color }}>
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              <tr>
                <td className="px-3 py-2 text-[var(--foreground)]">Rest of season (expected wins)</td>
                {ids.map((id) => {
                  const b = before.odds?.teams[id]?.expectedWins;
                  const a = after.odds?.teams[id]?.expectedWins;
                  return <td key={id} className="px-3 py-2">{b === undefined || a === undefined ? <Simulating /> : <WinsChange before={b} after={a} />}</td>;
                })}
              </tr>
              {seasonRows.map((row) => (
                <tr key={row.label}>
                  <td className="px-3 py-2 text-[var(--foreground)]">{row.label}</td>
                  {ids.map((id) => {
                    const b = before.odds ? row.get(before.odds.teams[id]) : null;
                    const a = after.odds ? row.get(after.odds.teams[id]) : null;
                    return <td key={id} className="px-3 py-2">{b === null || a === null ? <Simulating /> : <BeforeAfter before={b} after={a} bad={row.bad} />}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(ripple.length > 0 || mine) && (
        // Collapsed: the heading, how many teams move and what it does to you; tap for the table
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold text-[var(--foreground)]">Other teams affected</h3>
              <span className="block text-sm text-[var(--muted)]">
                {ripple.length === 0 ? 'No team moves half a point' : `${ripple.length} team${ripple.length === 1 ? '' : 's'} move half a point or more`}
                {mine && (() => {
                  const d = (mine.a.playoffs - mine.b.playoffs) * 100;
                  return <span className="font-semibold text-[var(--foreground)]"> · your playoff odds {Math.abs(d) < 0.5 ? '~0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`}</span>;
                })()}
              </span>
            </span>
            <span className="shrink-0 text-xl text-[var(--muted)] transition-transform group-open:rotate-90" aria-hidden="true">›</span>
          </summary>
          <p className="mb-3 mt-2 text-sm text-[var(--muted)]">
            Playoff spots are fixed, so what {one ? 'this move gains' : 'the two sides gain'} comes out of everyone else&apos;s odds: mostly
            the teams chasing the same spots and the ones about to play {one ? 'this team' : 'a team that got stronger'}.
          </p>
          {ripple.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No other team&apos;s odds move half a point or more.</p>
          ) : (
          <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                    <th className="px-3 py-2 font-medium">Team</th>
                    <th className="px-3 py-2 font-medium">Playoffs</th>
                    {ripple[0].a.champion !== null && <th className="px-3 py-2 font-medium">Win league</th>}
                    {ripple[0].a.lastPlace !== null && <th className="px-3 py-2 font-medium">Lose toilet bowl</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {ripple.map(({ id, a, b }) => (
                    <tr key={id} className={mineRow(id === mine?.id)}>
                      <td className="px-3 py-2 text-[var(--foreground)]">{name(id)}</td>
                      <td className="px-3 py-2"><BeforeAfter before={b.playoffs} after={a.playoffs} /></td>
                      {a.champion !== null && b.champion !== null && <td className="px-3 py-2"><BeforeAfter before={b.champion} after={a.champion} /></td>}
                      {a.lastPlace !== null && b.lastPlace !== null && <td className="px-3 py-2"><BeforeAfter before={b.lastPlace} after={a.lastPlace} bad /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}

      <div className={`grid gap-4 ${one ? '' : 'md:grid-cols-2'}`}>
        {sides.map((side) => {
          const change = side.change;
          const s = lineupSummary(change);
          const dropped = change.before.filter((p) => !change.after.includes(p) && change.dropped.includes(p));
          const added = change.after.filter((p) => !change.before.includes(p) && change.added.includes(p));
          return (
            <div key={side.rosterId} className="rounded-lg border border-[var(--border)] p-4 text-sm">
              {!one && (
                <div className="mb-2 font-semibold" style={{ color: side.color }}>
                  {side.name}
                </div>
              )}
              <p className="text-[var(--foreground)]">
                Expected lineup: {s.before.toFixed(1)} → <strong>{s.after.toFixed(1)}</strong> pts/wk (
                <span style={{ color: s.after - s.before >= 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>{signed(s.after - s.before)}</span>)
              </p>
              <p className="text-xs text-[var(--muted)]">
                If nothing else changes. The season odds count {Math.round(data.model.season.lineupWeight * 100)}% of this, the weight the playoff
                model gives every team&apos;s lineup this week; on real trades in other leagues, about 43% of a trade&apos;s projected change showed up.
              </p>
              {(s.in.length > 0 || s.out.length > 0) && (
                <p className="mt-2 text-[var(--foreground)]">
                  Week {firstWeek} lineup: {s.in.map((x) => `${playerName(x.playerId)} in (${x.slot})`).join(', ')}
                  {s.in.length && s.out.length ? '; ' : ''}
                  {s.out.map((x) => `${playerName(x.playerId)} out`).join(', ')}
                </p>
              )}
              {dropped.length > 0 && <p className="mt-2 text-[var(--foreground)]">Drops {dropped.map(playerName).join(', ')}</p>}
              {added.length > 0 && <p className="mt-2 text-[var(--foreground)]">Picks up {added.map(playerName).join(', ')}</p>}
              {side.extra}
            </div>
          );
        })}
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-[var(--foreground)]">Lineups</h3>
            <p className="text-sm text-[var(--muted)]">{one ? 'Your' : 'Each team’s'} best lineup and bench by expected points, {beforeLabel} and with it.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            Week
            <select
              value={shownWeek}
              onChange={(e) => setLineupWeek(Number(e.target.value))}
              className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-sm text-[var(--foreground)]"
            >
              {inputs.weeks.map((w) => (
                <option key={w} value={w}>
                  {w}
                  {w >= data.playoffWeekStart ? ' (playoffs)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={`grid gap-4 ${one ? '' : 'lg:grid-cols-2'}`}>
          {sides.map((s) => (
            <TradeLineups key={s.rosterId} inputs={inputs} players={data.players} change={s.change} sent={s.sent} received={s.received} week={shownWeek} name={s.name} color={s.color} />
          ))}
        </div>
      </div>

      {children}
    </>
  );
}
