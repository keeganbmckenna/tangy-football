'use client';

import { marketFair } from '@/lib/analyze/tradeFinder';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import SectionCard from '@/components/ui/SectionCard';
import { CHART_THEME } from '@/lib/constants';
import { bestLineup, formatOdds, simulatePlayoffOdds, type OddsResult, type TeamOdds } from '@/lib/analyze/playoffOdds';
import {
  lineupByWeek,
  meansAfterTrade,
  rosterAfterTrade,
  weeklyOutlook,
  type RosterChange,
  type TradeDataResponse,
  type TradePlayerInfo,
} from '@/lib/analyze/trade';
import type { OddsRequest } from '@/lib/analyze/trade.worker';
import type { TeamStats } from '@/lib/types';

export interface TradePreset {
  teamA: number;
  teamB: number;
  sendA: string[];
  sendB: string[];
}

interface TradeAnalyzerProps {
  data: TradeDataResponse;
  teamStats: TeamStats[];
  /** A trade to start with (e.g. from the trade finder) */
  initial?: TradePreset | null;
}

const SIMS = 20000;
const SEED = 2026;
const COLOR = { a: 'var(--trade-a)', b: 'var(--trade-b)' } as const;
const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

// ---------------------------------------------------------------------------
// Simulation in a worker (falls back to the main thread)

function useOddsSimulator() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (r: OddsResult) => void>());
  const nextId = useRef(1);

  useEffect(() => {
    try {
      const w = new Worker(new URL('../lib/analyze/trade.worker.ts', import.meta.url));
      w.onmessage = (e: MessageEvent<{ id: number; result: OddsResult }>) => {
        pending.current.get(e.data.id)?.(e.data.result);
        pending.current.delete(e.data.id);
      };
      worker.current = w;
    } catch {
      worker.current = null;
    }
    const waiting = pending.current;
    return () => {
      worker.current?.terminate();
      worker.current = null;
      waiting.clear();
    };
  }, []);

  return (request: Omit<OddsRequest, 'id'>): Promise<OddsResult> => {
    if (!worker.current) {
      return new Promise((resolve) =>
        setTimeout(() => {
          const r = request;
          resolve(simulatePlayoffOdds(r.teams, r.remaining, r.format, r.meanByWeek, r.spread, r.sims, r.seed, r.playoffWeekStart, r.toiletBowl));
        }, 0)
      );
    }
    const id = nextId.current++;
    return new Promise((resolve) => {
      pending.current.set(id, resolve);
      worker.current!.postMessage({ ...request, id });
    });
  };
}

// ---------------------------------------------------------------------------
// Formatting

const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

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

function BeforeAfter({ before, after, bad = false }: { before: number; after: number; bad?: boolean }) {
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

const positionRank = (p: string) => {
  const i = POSITION_ORDER.indexOf(p);
  return i === -1 ? POSITION_ORDER.length : i;
};

// ---------------------------------------------------------------------------
// Roster picker

function RosterPicker({
  side,
  rosterId,
  teamStats,
  otherTeam,
  onTeam,
  players,
  selected,
  onToggle,
  marketValues,
}: {
  side: 'a' | 'b';
  rosterId: number | null;
  teamStats: TeamStats[];
  otherTeam: number | null;
  onTeam: (id: number | null) => void;
  players: TradePlayerInfo[];
  selected: string[];
  onToggle: (id: string) => void;
  marketValues: boolean;
}) {
  const sorted = [...players].sort(
    (x, y) => positionRank(x.position) - positionRank(y.position) || y.expectedPerWeek - x.expectedPerWeek
  );
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: COLOR[side] }} aria-hidden />
        <label className="sr-only" htmlFor={`trade-team-${side}`}>
          {side === 'a' ? 'First manager' : 'Second manager'}
        </label>
        <select
          id={`trade-team-${side}`}
          value={rosterId ?? ''}
          onChange={(e) => onTeam(e.target.value ? Number(e.target.value) : null)}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--foreground)]"
        >
          <option value="">Choose a manager</option>
          {teamStats
            .filter((t) => t.rosterId !== otherTeam)
            .sort((x, y) => x.username.localeCompare(y.username, undefined, { sensitivity: 'base' }))
            .map((t) => (
              <option key={t.rosterId} value={t.rosterId}>
                {t.username}
              </option>
            ))}
        </select>
      </div>
      {rosterId === null ? (
        <p className="p-4 text-sm text-[var(--muted)]">Pick a manager to see their roster.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {sorted.map((p) => {
            const on = selected.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onToggle(p.id)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-[var(--neutral-bg)]"
                  style={on ? { boxShadow: `inset 4px 0 0 ${COLOR[side]}`, backgroundColor: 'var(--neutral-bg)' } : undefined}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold text-white"
                    style={{ borderColor: on ? COLOR[side] : 'var(--chart-axis)', backgroundColor: on ? COLOR[side] : 'transparent' }}
                    aria-hidden
                  >
                    {on ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[var(--foreground)]">{p.name}</span>
                    <span className="block text-xs text-[var(--muted)]">
                      {p.position}
                      {p.team ? ` · ${p.team}` : ''}
                      {p.seasonPerGame !== null ? ` · ${p.seasonPerGame.toFixed(1)} ppg` : ''}
                      {p.injury ? <span className="ml-1 font-semibold text-[var(--danger-text)]">{p.injury}</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm text-[var(--foreground)]">{p.expectedPerWeek.toFixed(1)}/wk</span>
                    {marketValues && (
                      <span className="block text-xs text-[var(--muted)]">{p.value !== null ? p.value.toLocaleString() : '—'}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly win odds chart

interface ChartRow {
  week: number;
  aBefore?: number;
  aAfter?: number;
  bBefore?: number;
  bAfter?: number;
  aOpponent?: string;
  bOpponent?: string;
}

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

function WinOddsChart({ rows, nameA, nameB }: { rows: ChartRow[]; nameA: string; nameB: string }) {
  const pctLabel = (v?: number) => (v === undefined ? '—' : `${Math.round(v)}%`);
  const tap = useTapTooltip()();
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
        <LegendItem color={COLOR.a} dashed={false} label={`${nameA} after`} />
        <LegendItem color={COLOR.a} dashed label={`${nameA} before`} />
        <LegendItem color={COLOR.b} dashed={false} label={`${nameB} after`} />
        <LegendItem color={COLOR.b} dashed label={`${nameB} before`} />
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: -8 }} {...tap.chartProps}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} vertical={false} />
          <XAxis
            dataKey="week"
            tickFormatter={(w) => `W${w}`}
            tick={{ fill: CHART_THEME.tick, fontSize: 12 }}
            axisLine={{ stroke: CHART_THEME.axis }}
            tickLine={{ stroke: CHART_THEME.axis }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: CHART_THEME.tick, fontSize: 12 }}
            axisLine={{ stroke: CHART_THEME.axis }}
            tickLine={{ stroke: CHART_THEME.axis }}
          />
          <ReferenceLine y={50} stroke={CHART_THEME.axis} strokeDasharray="2 4" />
          <Tooltip
            active={tap.active}
            cursor={{ stroke: CHART_THEME.axis, strokeWidth: 1 }}
            wrapperStyle={{ maxWidth: 260 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0].payload as ChartRow;
              return (
                <div
                  className="rounded-lg border px-3 py-2 text-xs shadow-lg"
                  style={{ backgroundColor: CHART_THEME.tooltipBg, borderColor: CHART_THEME.tooltipBorder, color: CHART_THEME.tooltipText }}
                >
                  <div className="mb-1 font-semibold">Week {r.week}</div>
                  {r.aBefore !== undefined && (
                    <div className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COLOR.a }} />
                      <span>
                        {nameA} vs {r.aOpponent}: {pctLabel(r.aBefore)} → <strong>{pctLabel(r.aAfter)}</strong>
                      </span>
                    </div>
                  )}
                  {r.bBefore !== undefined && (
                    <div className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: COLOR.b }} />
                      <span>
                        {nameB} vs {r.bOpponent}: {pctLabel(r.bBefore)} → <strong>{pctLabel(r.bAfter)}</strong>
                      </span>
                    </div>
                  )}
                  {r.aOpponent === nameB && <div className="mt-1" style={{ color: CHART_THEME.tooltipMuted }}>They play each other this week</div>}
                </div>
              );
            }}
          />
          {(['a', 'b'] as const).flatMap((side) => [
            <Line
              key={`${side}Before`}
              dataKey={`${side}Before`}
              stroke={COLOR[side]}
              strokeOpacity={0.55}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 4, fill: 'var(--surface-elevated)', stroke: COLOR[side], strokeWidth: 2, strokeOpacity: 0.55 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />,
            <Line
              key={`${side}After`}
              dataKey={`${side}After`}
              stroke={COLOR[side]}
              strokeWidth={2.5}
              dot={{ r: 4, fill: COLOR[side], stroke: 'var(--surface-elevated)', strokeWidth: 2 }}
              activeDot={{ r: 6 }}
              connectNulls
              isAnimationActive={false}
            />,
          ])}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analyzer

interface SeasonRow {
  label: string;
  get: (t: TeamOdds) => number | null;
  bad?: boolean;
}

export default function TradeAnalyzer({ data, teamStats, initial = null }: TradeAnalyzerProps) {
  // A fresh analyzer starts with your team on the left, if you've picked one in the header
  const myTeam = useMyTeam();
  const [teamA, setTeamA] = useState<number | null>(initial?.teamA ?? myTeam.rosterId);
  const [teamB, setTeamB] = useState<number | null>(initial?.teamB ?? null);
  const [sendA, setSendA] = useState<string[]>(initial?.sendA ?? []);
  const [sendB, setSendB] = useState<string[]>(initial?.sendB ?? []);
  const [baseOdds, setBaseOdds] = useState<OddsResult | null>(null);
  const [tradeOdds, setTradeOdds] = useState<{ key: string; odds: OddsResult } | null>(null);
  const simulate = useOddsSimulator();

  // Managers' names: they're how people know each other in the league
  const name = (id: number | null) => teamStats.find((t) => t.rosterId === id)?.username.trim() ?? (id === null ? '' : `Team ${id}`);
  const { inputs } = data;
  const rosterPlayers = (id: number | null) =>
    id === null ? [] : (inputs.rosters[id] ?? []).map((p) => data.players[p]).filter((p): p is TradePlayerInfo => !!p);
  const hasDivisions = data.format.hasDivisions;
  const firstWeek = data.remaining.reduce((m, g) => Math.min(m, g.week), Infinity);

  const request = (meanByWeek: Record<number, Record<number, number>>) =>
    simulate({
      teams: data.teams,
      remaining: data.remaining,
      format: data.format,
      meanByWeek,
      spread: data.spread,
      sims: SIMS,
      seed: SEED,
      playoffWeekStart: data.playoffWeekStart,
      toiletBowl: data.hasToiletBowl,
    });

  // Odds without a trade (the Playoffs tab's numbers), once
  useEffect(() => {
    let cancelled = false;
    request(data.meanByWeek).then((r) => !cancelled && setBaseOdds(r));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const trade = useMemo(() => {
    if (teamA === null || teamB === null || sendA.length + sendB.length === 0) return null;
    const changeA = rosterAfterTrade(inputs, { rosterId: teamA, sends: sendA, receives: sendB });
    const changeB = rosterAfterTrade(inputs, { rosterId: teamB, sends: sendB, receives: sendA }, changeA.added);
    const { meanByWeek } = meansAfterTrade(data.meanByWeek, inputs, [changeA, changeB]);
    const outlook = (id: number, means: Record<number, Record<number, number>>) =>
      weeklyOutlook(id, data.remaining, means, data.spread, inputs.lastScoredWeek);
    return {
      key: `${teamA}:${[...sendA].sort().join(',')}|${teamB}:${[...sendB].sort().join(',')}`,
      changes: { a: changeA, b: changeB },
      meanByWeek,
      outlook: {
        aBefore: outlook(teamA, data.meanByWeek),
        aAfter: outlook(teamA, meanByWeek),
        bBefore: outlook(teamB, data.meanByWeek),
        bAfter: outlook(teamB, meanByWeek),
      },
    };
  }, [data, inputs, teamA, teamB, sendA, sendB]);

  // Odds with the trade: same random draws as the baseline, so only the trade moves them
  useEffect(() => {
    if (!trade) return;
    let cancelled = false;
    request(trade.meanByWeek).then((odds) => !cancelled && setTradeOdds({ key: trade.key, odds }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade]);
  const afterOdds = trade && tradeOdds?.key === trade.key ? tradeOdds.odds : null;

  const toggle = (setter: (f: (s: string[]) => string[]) => void) => (id: string) =>
    setter((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const pickTeam = (side: 'a' | 'b') => (id: number | null) => {
    if (side === 'a') {
      setTeamA(id);
      setSendA([]);
    } else {
      setTeamB(id);
      setSendB([]);
    }
  };

  const nameA = name(teamA);
  const nameB = name(teamB);

  const chartRows: ChartRow[] = useMemo(() => {
    if (!trade) return [];
    const rows = new Map<number, ChartRow>();
    const row = (w: number) => rows.get(w) ?? rows.set(w, { week: w }).get(w)!;
    const put = (list: typeof trade.outlook.aBefore, key: 'aBefore' | 'aAfter' | 'bBefore' | 'bAfter') =>
      list.forEach((o) => {
        const r = row(o.week);
        r[key] = Math.round(o.winProbability * 1000) / 10;
        if (key === 'aBefore') r.aOpponent = name(o.opponent);
        if (key === 'bBefore') r.bOpponent = name(o.opponent);
      });
    put(trade.outlook.aBefore, 'aBefore');
    put(trade.outlook.aAfter, 'aAfter');
    put(trade.outlook.bBefore, 'bBefore');
    put(trade.outlook.bAfter, 'bAfter');
    return [...rows.values()].sort((x, y) => x.week - y.week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade, teamStats]);

  const seasonRows: SeasonRow[] = [
    { label: 'Make the playoffs', get: (t) => t.playoffs },
    ...(hasDivisions ? [{ label: 'Win the division', get: (t: TeamOdds) => t.division }] : []),
    { label: 'Playoff bye', get: (t) => t.bye },
    ...(baseOdds && Object.values(baseOdds.teams)[0]?.champion !== null ? [{ label: 'Win the league', get: (t: TeamOdds) => t.champion }] : []),
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
    const ids = (s: typeof startersBefore) => new Set(s.map((x) => x.playerId));
    const before = ids(startersBefore);
    const after = ids(startersAfter);
    return {
      before: avg(change.before),
      after: avg(change.after),
      in: startersAfter.filter((s) => !before.has(s.playerId)),
      out: startersBefore.filter((s) => !after.has(s.playerId)),
    };
  };

  const playerName = (id: string) => data.players[id]?.name ?? id;
  const marketTotal = (ids: string[]) => {
    const valued = ids.map((p) => data.players[p]?.value).filter((v): v is number => v !== null && v !== undefined);
    return { total: valued.reduce((s, v) => s + v, 0), valued: valued.length, count: ids.length };
  };

  const ripple =
    baseOdds && afterOdds && trade
      ? data.teams
          .filter((t) => t.rosterId !== teamA && t.rosterId !== teamB)
          .map((t) => ({ id: t.rosterId, b: baseOdds.teams[t.rosterId], a: afterOdds.teams[t.rosterId] }))
          .filter(({ a, b }) =>
            [a.playoffs - b.playoffs, (a.champion ?? 0) - (b.champion ?? 0), (a.lastPlace ?? 0) - (b.lastPlace ?? 0)].some((d) => Math.abs(d) >= 0.01)
          )
          .sort((x, y) => Math.abs(y.a.playoffs - y.b.playoffs) - Math.abs(x.a.playoffs - x.b.playoffs))
      : [];

  return (
    <SectionCard
      title="Trade Analyzer"
      subtitle={`Pick two managers and the players moving. Trades are allowed through week ${data.tradeDeadline || data.regularSeasonEnd}.`}
      gradientType="primary"
    >
      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <RosterPicker
            side="a"
            rosterId={teamA}
            teamStats={teamStats}
            otherTeam={teamB}
            onTeam={pickTeam('a')}
            players={rosterPlayers(teamA)}
            selected={sendA}
            onToggle={toggle(setSendA)}
            marketValues={data.marketValues}
          />
          <RosterPicker
            side="b"
            rosterId={teamB}
            teamStats={teamStats}
            otherTeam={teamA}
            onTeam={pickTeam('b')}
            players={rosterPlayers(teamB)}
            selected={sendB}
            onToggle={toggle(setSendB)}
            marketValues={data.marketValues}
          />
        </div>
        {data.marketValues && (
          <p className="-mt-3 text-xs text-[var(--muted)]">
            Each player: points per game this season, expected points per remaining week (half his projection, half his
            season scoring, as the odds model values him), and his{' '}
            <a href="https://fantasycalc.com" target="_blank" rel="noreferrer" className="underline">FantasyCalc</a> redraft
            value (the trade market&apos;s price; kickers and defenses aren&apos;t valued).
          </p>
        )}

        {!trade ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            {teamA === null || teamB === null
              ? 'Choose both managers, then tap the players each one sends.'
              : 'Tap the players each manager sends.'}
          </p>
        ) : (
          <>
            <div className="rounded-lg bg-[var(--surface)] p-3 text-sm text-[var(--foreground)]">
              <span style={{ color: COLOR.a }} className="font-semibold">{nameA}</span> gets{' '}
              {sendB.length ? sendB.map(playerName).join(', ') : 'nothing'} ·{' '}
              <span style={{ color: COLOR.b }} className="font-semibold">{nameB}</span> gets{' '}
              {sendA.length ? sendA.map(playerName).join(', ') : 'nothing'}
              <button
                type="button"
                onClick={() => {
                  setSendA([]);
                  setSendB([]);
                }}
                className="ml-3 text-xs text-[var(--muted)] underline"
              >
                Clear
              </button>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-[var(--foreground)]">Win odds each week</h3>
              <p className="mb-3 text-sm text-[var(--muted)]">
                Each team&apos;s chance to win its game, without the trade (dashed) and with it (solid). Games more than a
                week away are deliberately cautious: single games that far out have been hard to call.
              </p>
              <WinOddsChart rows={chartRows} nameA={nameA} nameB={nameB} />
            </div>

            <div>
              <h3 className="text-lg font-semibold text-[var(--foreground)]">Season outlook</h3>
              <p className="mb-3 text-sm text-[var(--muted)]">
                Before → after, with the change in percentage points. Changes under half a point are shown as ~0.
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                      <th className="w-[38%] px-3 py-2 font-medium" />
                      <th className="px-3 py-2 font-medium" style={{ color: COLOR.a }}>{nameA}</th>
                      <th className="px-3 py-2 font-medium" style={{ color: COLOR.b }}>{nameB}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    <tr>
                      <td className="px-3 py-2 text-[var(--foreground)]">Rest of season (expected wins)</td>
                      {[teamA!, teamB!].map((id) => {
                        const b = baseOdds?.teams[id]?.expectedWins;
                        const a = afterOdds?.teams[id]?.expectedWins;
                        if (b === undefined || a === undefined) {
                          return (
                            <td key={id} className="px-3 py-2">
                              <span className="text-xs text-[var(--muted)]">Simulating…</span>
                            </td>
                          );
                        }
                        const d = a - b;
                        return (
                          <td key={id} className="px-3 py-2">
                            <span className="whitespace-nowrap">
                              <span className="text-[var(--muted)]">{b.toFixed(1)}</span>
                              <span className="mx-1 text-[var(--muted)]">→</span>
                              <span className="font-semibold text-[var(--foreground)]">{a.toFixed(1)}</span>
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
                          </td>
                        );
                      })}
                    </tr>
                    {seasonRows.map((row) => (
                      <tr key={row.label}>
                        <td className="px-3 py-2 text-[var(--foreground)]">{row.label}</td>
                        {[teamA!, teamB!].map((id) => {
                          const b = baseOdds ? row.get(baseOdds.teams[id]) : null;
                          const a = afterOdds ? row.get(afterOdds.teams[id]) : null;
                          return (
                            <td key={id} className="px-3 py-2">
                              {b === null || a === null ? (
                                <span className="text-xs text-[var(--muted)]">Simulating…</span>
                              ) : (
                                <BeforeAfter before={b} after={a} bad={row.bad} />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {(['a', 'b'] as const).map((side) => {
                const change = trade.changes[side];
                const s = lineupSummary(change);
                const gives = side === 'a' ? sendA : sendB;
                const gets = side === 'a' ? sendB : sendA;
                const give = marketTotal(gives);
                const get = marketTotal(gets);
                return (
                  <div key={side} className="rounded-lg border border-[var(--border)] p-4 text-sm">
                    <div className="mb-2 font-semibold" style={{ color: COLOR[side] }}>
                      {side === 'a' ? nameA : nameB}
                    </div>
                    <p className="text-[var(--foreground)]">
                      Expected lineup: {s.before.toFixed(1)} → <strong>{s.after.toFixed(1)}</strong> pts/wk (
                      <span style={{ color: s.after - s.before >= 0 ? 'var(--success-text)' : 'var(--danger-text)' }}>
                        {signed(s.after - s.before)}
                      </span>
                      )
                    </p>
                    <p className="text-xs text-[var(--muted)]">If nothing else changes. The odds count 75% of this, the same weight the playoff model gives every team&apos;s lineup.</p>
                    {(s.in.length > 0 || s.out.length > 0) && (
                      <p className="mt-2 text-[var(--foreground)]">
                        Week {firstWeek} lineup:{' '}
                        {s.in.map((x) => `${playerName(x.playerId)} in (${x.slot})`).join(', ')}
                        {s.in.length && s.out.length ? '; ' : ''}
                        {s.out.map((x) => `${playerName(x.playerId)} out`).join(', ')}
                      </p>
                    )}
                    {change.dropped.length > 0 && (
                      <p className="mt-2 text-[var(--foreground)]">
                        Roster full: drops {change.dropped.map(playerName).join(', ')} (the least useful player)
                      </p>
                    )}
                    {change.added.length > 0 && (
                      <p className="mt-2 text-[var(--foreground)]">
                        Open roster spot: picks up {change.added.map(playerName).join(', ')} (best free agent for the lineup)
                      </p>
                    )}
                    {data.marketValues && (
                      <p className="mt-2 text-[var(--foreground)]">
                        Market value: gives {give.total.toLocaleString()}, gets {get.total.toLocaleString()}
                        {give.valued < give.count || get.valued < get.count ? ' (kickers and defenses not valued)' : ''}
                        {marketFair(gives.map((p) => data.players[p]?.value ?? 0), gets.map((p) => data.players[p]?.value ?? 0)) === false && (
                          <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-[var(--warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--warning-text)]">
                            Overpays by market value
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {ripple.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-[var(--foreground)]">Other teams affected</h3>
                <p className="mb-3 text-sm text-[var(--muted)]">Teams whose odds move by a point or more, mostly through who they play.</p>
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
                        <tr key={id}>
                          <td className="px-3 py-2 text-[var(--foreground)]">{name(id)}</td>
                          <td className="px-3 py-2"><BeforeAfter before={b.playoffs} after={a.playoffs} /></td>
                          {a.champion !== null && b.champion !== null && (
                            <td className="px-3 py-2"><BeforeAfter before={b.champion} after={a.champion} /></td>
                          )}
                          {a.lastPlace !== null && b.lastPlace !== null && (
                            <td className="px-3 py-2"><BeforeAfter before={b.lastPlace} after={a.lastPlace} bad /></td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <details className="rounded-lg border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
              <summary className="cursor-pointer font-medium text-[var(--foreground)]">How this works</summary>
              <div className="mt-3 space-y-2">
                <p>
                  The &quot;before&quot; numbers are the Playoffs tab&apos;s: 20,000 simulated seasons on the real schedule. Each
                  player is worth half his projection for the week and half his points per game this season, and a team&apos;s
                  expected score is the league average plus 75% of how far its best lineup of those values is above or below the
                  league&apos;s. The &quot;after&quot; run uses the same random draws, so differences come from the trade, not
                  simulation noise.
                </p>
                <p>
                  Team strength comes only from who&apos;s on the roster, so a trade counts like any other roster: the players
                  bring their projections and their season production with them, and two teams that swap whole rosters swap
                  strengths (records already banked stay put). Backtested on this league&apos;s 2022-2025 trades, this predicted
                  the trading teams&apos; playoff odds better than the other ways tried.
                </p>
                <p>
                  Weekly win odds use a wider spread for games more than a week away (2× the week-to-week spread, 0.8× next week),
                  which matched how those games actually went in the same backtest. The table&apos;s season odds keep the
                  Playoffs tab&apos;s spread, which backtested as well calibrated.
                </p>
                <p>
                  Trades that leave a roster over the limit drop the player who costs the lineup least; trades that open a spot
                  pick up the free agent who helps the lineup most. Draft picks and FAAB aren&apos;t part of the analyzer.
                </p>
              </div>
            </details>
          </>
        )}
      </div>
    </SectionCard>
  );
}
