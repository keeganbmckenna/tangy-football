'use client';

import { useState, type ReactNode } from 'react';
import { Area, AreaChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchFirst, useSharedFetch } from '@/hooks/useSharedFetch';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import type { WinHistory } from '@/lib/winHistory';

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
  const tooltip = ({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) => {
    const pt = active ? (payload?.[0]?.payload as (typeof points)[number] | undefined) : undefined;
    if (!pt) return null;
    return (
      <div className="rounded-md border border-[var(--chart-tooltip-border)] bg-[var(--chart-tooltip-bg)] px-2 py-1 text-xs shadow">
        <div className="text-[var(--chart-tooltip-muted)]">{TIME.format(pt.t * 1000)} ET</div>
        <div className="font-semibold text-[var(--chart-tooltip-text)]">
          {pt.sa.toFixed(1)}–{pt.sb.toFixed(1)} · {a.name} {pt.p.toFixed(0)}%
        </div>
      </div>
    );
  };
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
              ? `${a.name} ${points[points.length - 1].p.toFixed(0)}% now`
              : won
                ? `${a.name} won from ${low.toFixed(0)}%`
                : `${a.name} peaked at ${high.toFixed(0)}%`}
          {view === 'odds' && swings > 0 && ` · ${swings} lead change${swings === 1 ? '' : 's'}`}
        </div>
      </div>
      <div className="h-20 w-full">
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
    </div>
  );
}
