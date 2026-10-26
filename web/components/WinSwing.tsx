'use client';

import { useState, type ReactNode } from 'react';
import { Area, AreaChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchFirst, useSharedFetch } from '@/hooks/useSharedFetch';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import { cleanPlay, type WinHistory } from '@/lib/winHistory';

interface WinSwingProps {
  season: string;
  week: number;
  /** The dialog's left team (odds are shown from its side) and right team */
  a: { rosterId: number; name: string };
  b: { rosterId: number; name: string };
  /** The week in progress: the odds saved so far (/api/live/history), reloaded when refreshKey changes */
  live?: boolean;
  refreshKey?: string;
}

/** Plays closer than this share of the chart's width share one marker */
const GROUP_SHARE = 0.03;

/** Each team's line in the score view */
const A_COLOR = '#3b82f6';
const B_COLOR = '#f59e0b';

// The view picked, for every matchup this visit
let rememberedView: 'odds' | 'score' = 'odds';

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' });
const TIME = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

/**
 * How a matchup swung: the left team's live win odds through the week, or both teams' scores
 * (a toggle), replayed from the play-by-play with the Live tab's model (lib/winHistory.ts) or
 * saved live. Only game time is drawn, so the gaps between Thursday, Sunday and Monday are
 * closed up and marked by day.
 */
export default function WinSwing({ season, week, a, b, live = false, refreshKey = '' }: WinSwingProps) {
  const [view, setViewState] = useState(rememberedView);
  // The big play whose details show (tapped, or hovered)
  const [picked, setPicked] = useState<number | null>(null);
  const setView = (v: typeof view) => {
    rememberedView = v;
    setViewState(v);
  };
  // A finished week: the play-by-play replay, or the odds saved live until it's built
  const saved = `/api/live/history?season=${season}&week=${week}`;
  const { data } = useSharedFetch<WinHistory>(`win-history:${season}:${week}:${live ? refreshKey : ''}`, () =>
    fetchFirst(live ? [saved] : [`/data/win-history/${season}/${week}.json`, saved], 'the win history')
  );
  const m = data?.matchups.find((x) => (x.a === a.rosterId && x.b === b.rosterId) || (x.a === b.rosterId && x.b === a.rosterId));
  if (!data || !m || data.times.length < 2) return null;

  const flip = m.a !== a.rosterId;
  const points = data.times.map((t, i) => {
    const p = flip ? 1 - m.odds[i] : m.odds[i];
    const [sa, sb] = flip ? [m.scores[i][1], m.scores[i][0]] : m.scores[i];
    return { i, t, p: Math.round(p * 1000) / 10, sa, sb };
  });
  // Where each game day starts, for its label
  const days = points.filter((pt, i) => i === 0 || DAY.format(pt.t * 1000) !== DAY.format(points[i - 1].t * 1000));
  // Lead changes: the favorite flipping, counted only once the odds get past 55% the other way
  let swings = 0;
  let side = 0;
  for (const pt of points) {
    const now = pt.p > 55 ? 1 : pt.p < 45 ? -1 : 0;
    if (now && side && now !== side) swings++;
    if (now) side = now;
  }
  const low = Math.min(...points.map((pt) => pt.p));
  const high = Math.max(...points.map((pt) => pt.p));
  const won = points[points.length - 1].p > 50;
  // Share of game time the left team was ahead on the scoreboard
  const scored = points.filter((pt) => pt.sa > 0 || pt.sb > 0);
  const ledShare = scored.length ? Math.round((100 * scored.filter((pt) => pt.sa > pt.sb).length) / scored.length) : 0;
  const dayLines: ReactNode = days.map((d) => (
    <ReferenceLine
      key={d.i}
      x={d.i}
      stroke="var(--border)"
      label={{ value: DAY.format(d.t * 1000), position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 9 }}
    />
  ));
  // The favorite and its chance (always 50% or more), from the left team's odds in percent
  const favored = (p: number) => (p >= 50 ? `${a.name} ${p.toFixed(0)}%` : `${b.name} ${(100 - p).toFixed(0)}%`);
  const tooltip = ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
    const pt = active ? (payload?.[0]?.payload as (typeof points)[number] | undefined) : undefined;
    if (!pt) return null;
    return (
      <div className="rounded-md border border-[var(--chart-tooltip-border)] bg-[var(--chart-tooltip-bg)] px-2 py-1 text-xs shadow">
        <div className="text-[var(--chart-tooltip-muted)]">{TIME.format(pt.t * 1000)} ET</div>
        <div className="font-semibold text-[var(--chart-tooltip-text)]">
          {pt.sa.toFixed(1)}–{pt.sb.toFixed(1)} · {favored(pt.p)}
        </div>
      </div>
    );
  };
  // Big plays, from the left team's side, placed between the samples around them
  const plays = (m.events ?? []).map((e) => {
    const before = flip ? 1 - e.before : e.before;
    const after = flip ? 1 - e.after : e.after;
    const players = e.players.map((pl) => ({ ...pl, left: flip ? pl.side === 'b' : pl.side === 'a' }));
    const j = data.times.findIndex((t) => t > e.t);
    const x = j === -1 ? data.times.length - 1 : j === 0 ? 0 : j - 1 + (e.t - data.times[j - 1]) / (data.times[j] - data.times[j - 1]);
    const net = players.reduce((s, pl) => s + (pl.left ? pl.pts : -pl.pts), 0);
    return { t: e.t, desc: e.desc, before, after, players, x, helpsLeft: after !== before ? after > before : net >= 0 };
  });
  // Plays within GROUP_SHARE of the chart's width of each other share one marker
  const groups: number[][] = [];
  plays.forEach((pl, i) => {
    const last = groups[groups.length - 1];
    if (last && (pl.x - plays[last[0]].x) / Math.max(points.length - 1, 1) < GROUP_SHARE) last.push(i);
    else groups.push([i]);
  });
  const shown = picked !== null && groups[picked] ? groups[picked].map((i) => plays[i]) : null;
  // A group helps whichever side its plays moved the odds toward
  const groupHelpsLeft = (g: number[]) => {
    const first = plays[g[0]];
    const last = plays[g[g.length - 1]];
    return last.after !== first.before ? last.after > first.before : first.helpsLeft;
  };
  const markerColor = (helpsLeft: boolean) =>
    view === 'score' ? (helpsLeft ? A_COLOR : B_COLOR) : helpsLeft ? RESULT_DOT_COLORS.W : RESULT_DOT_COLORS.L;
  // Above 50% in the left team's color, below in the right's: the gradient splits at the 50% line
  const id = `swing-${season}-${week}-${m.matchupId}`;

  return (
    <div className="px-2 pt-3 sm:px-3">
      <div className="mb-1 text-[10px] text-[var(--muted)] sm:text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold uppercase tracking-wider">How it swung</span>
          <span className="flex gap-0.5 rounded-full border border-[var(--border)] p-0.5" role="group" aria-label="Show">
            {(['odds', 'score'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-full px-2 py-0.5 font-semibold ${view === v ? 'bg-[var(--info-bg)] text-[var(--info-text)]' : 'hover:text-[var(--foreground)]'}`}
              >
                {v === 'odds' ? 'Odds' : 'Score'}
              </button>
            ))}
          </span>
        </div>
        <div className="mt-0.5 truncate">
          {view === 'score'
            ? `${a.name} led ${ledShare}% of the time`
            : live
              ? `${favored(points[points.length - 1].p)} now`
              : won
                ? `${a.name} won from ${low.toFixed(0)}%`
                : `${a.name} peaked at ${high.toFixed(0)}%`}
          {view === 'odds' && swings > 0 && ` · ${swings} lead change${swings === 1 ? '' : 's'}`}
        </div>
      </div>
      <div className="relative h-20 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {view === 'score' ? (
            <LineChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="i" type="number" domain={[0, points.length - 1]} hide />
              <YAxis domain={[0, 'dataMax']} hide />
              {dayLines}
              <Tooltip cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} content={tooltip} />
              <Line type="stepAfter" dataKey="sa" stroke={A_COLOR} strokeWidth={1.75} dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="sb" stroke={B_COLOR} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            </LineChart>
          ) : (
            <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                {/* In the chart's own pixels (80 high, 2 of top margin), so the split sits on the 50% line */}
                <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="2" x2="0" y2="80">
                  <stop offset="0%" stopColor={RESULT_DOT_COLORS.W} stopOpacity={0.45} />
                  <stop offset="50%" stopColor={RESULT_DOT_COLORS.W} stopOpacity={0.08} />
                  <stop offset="50%" stopColor={RESULT_DOT_COLORS.L} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={RESULT_DOT_COLORS.L} stopOpacity={0.45} />
                </linearGradient>
              </defs>
              <XAxis dataKey="i" type="number" domain={[0, points.length - 1]} hide />
              <YAxis domain={[0, 100]} hide />
              <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="3 3" />
              {dayLines}
              <Tooltip cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} content={tooltip} />
              <Area type="monotone" dataKey="p" stroke="var(--foreground)" strokeWidth={1.25} fill={`url(#${id})`} baseValue={50} isAnimationActive={false} />
            </AreaChart>
          )}
        </ResponsiveContainer>
        {/* Big plays: a thin line each (close ones share a line, with a count), with a wider area to tap */}
        {groups.map((g, gi) => {
          const x = g.reduce((sum, i) => sum + plays[i].x, 0) / g.length;
          const on = picked === gi;
          return (
            <button
              key={`${plays[g[0]].t}-${gi}`}
              type="button"
              aria-label={`${g.length > 1 ? `${g.length} big plays` : 'Big play'} at ${TIME.format(plays[g[0]].t * 1000)}`}
              onClick={() => setPicked(on ? null : gi)}
              onMouseEnter={() => setPicked(gi)}
              className="absolute inset-y-0 w-4 -translate-x-1/2"
              style={{ left: `${(x / Math.max(points.length - 1, 1)) * 100}%` }}
            >
              <span
                className="absolute inset-y-0 left-1/2 -translate-x-1/2"
                style={{
                  width: on || g.length > 1 ? 2 : 1,
                  backgroundColor: markerColor(groupHelpsLeft(g)),
                  opacity: picked === null || on ? 0.9 : 0.35,
                }}
              />
              {g.length > 1 && (
                <span
                  className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full px-1 text-[8px] font-bold leading-3 text-white"
                  style={{ backgroundColor: markerColor(groupHelpsLeft(g)) }}
                >
                  {g.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between gap-2 text-[10px] text-[var(--muted)]">
        {view === 'score' ? (
          <>
            <span className="flex min-w-0 items-center gap-1">
              <span className="h-0.5 w-3 shrink-0" style={{ backgroundColor: A_COLOR }} />
              <span className="truncate">{a.name}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1">
              <span className="h-0.5 w-3 shrink-0" style={{ backgroundColor: B_COLOR }} />
              <span className="truncate">{b.name}</span>
            </span>
          </>
        ) : (
          <>
            <span className="truncate">↑ {a.name}</span>
            <span className="truncate">↓ {b.name}</span>
          </>
        )}
      </div>
      {shown && picked !== null && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-xs">
          {/* Step through the matchup's big plays in time order */}
          <div className="mb-1 flex items-center justify-between gap-2 text-[var(--muted)]">
            <button
              type="button"
              onClick={() => setPicked(Math.max(0, picked - 1))}
              disabled={picked === 0}
              aria-label="Previous big play"
              className="rounded px-2 py-0.5 text-sm leading-none hover:text-[var(--foreground)] disabled:opacity-30"
            >
              ‹
            </button>
            <span>
              {groups[picked].length > 1
                ? `Plays ${groups[picked][0] + 1}–${groups[picked][groups[picked].length - 1] + 1} of ${plays.length}`
                : `Play ${groups[picked][0] + 1} of ${plays.length}`}
            </span>
            <button
              type="button"
              onClick={() => setPicked(Math.min(groups.length - 1, picked + 1))}
              disabled={picked === groups.length - 1}
              aria-label="Next big play"
              className="rounded px-2 py-0.5 text-sm leading-none hover:text-[var(--foreground)] disabled:opacity-30"
            >
              ›
            </button>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {shown.map((pl) => (
              <div key={pl.t} className="py-1.5 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="shrink-0 text-[var(--muted)]">{TIME.format(pl.t * 1000)} ET</span>
                  <span className="truncate font-semibold tabular-nums" style={{ color: markerColor(pl.helpsLeft) }}>
                    {/* From the side of the team the play helped */}
                    {pl.helpsLeft ? a.name : b.name} {Math.round((pl.helpsLeft ? pl.before : 1 - pl.before) * 100)}% →{' '}
                    {Math.round((pl.helpsLeft ? pl.after : 1 - pl.after) * 100)}%
                  </span>
                </div>
                <div className="mt-0.5 text-[var(--foreground)]">{pl.desc ? cleanPlay(pl.desc) : 'Points changed (saved live, before the play-by-play)'}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[var(--muted)]">
                  {pl.players.map((p) => (
                    <span key={`${p.side}-${p.name}`}>
                      <span style={{ color: p.left ? A_COLOR : B_COLOR }}>●</span> {p.name} {p.pts > 0 ? '+' : '−'}
                      {Math.abs(p.pts).toFixed(1)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
