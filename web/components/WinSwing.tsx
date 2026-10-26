'use client';

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchFirst, useSharedFetch } from '@/hooks/useSharedFetch';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import type { WinHistory } from '@/lib/winHistory';

interface WinSwingProps {
  season: string;
  week: number;
  /** The dialog's left team (odds are shown from its side) and right team */
  a: { rosterId: number; name: string };
  b: { rosterId: number; name: string };
}

const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' });
const TIME = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

/**
 * How a finished matchup swung: the left team's live win odds through the week, replayed from
 * the play-by-play with the Live tab's model (lib/winHistory.ts). Only game time is drawn, so
 * the gaps between Thursday, Sunday and Monday are closed up and marked by day.
 */
export default function WinSwing({ season, week, a, b }: WinSwingProps) {
  const { data } = useSharedFetch<WinHistory>(`win-history:${season}:${week}`, () =>
    fetchFirst([`/data/win-history/${season}/${week}.json`], 'the win history')
  );
  const m = data?.matchups.find((x) => (x.a === a.rosterId && x.b === b.rosterId) || (x.a === b.rosterId && x.b === a.rosterId));
  if (!data || !m) return null;

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
  // Above 50% in the left team's color, below in the right's: the gradient splits at the 50% line
  const id = `swing-${season}-${week}-${m.matchupId}`;

  return (
    <div className="px-2 pt-3 sm:px-3">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[10px] text-[var(--muted)] sm:text-xs">
        <span className="shrink-0 font-semibold uppercase tracking-wider">How it swung</span>
        <span className="truncate">
          {won ? `${a.name} won from ${low.toFixed(0)}%` : `${a.name} peaked at ${high.toFixed(0)}%`}
          {swings > 0 && ` · ${swings} lead change${swings === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="h-20 w-full">
        <ResponsiveContainer width="100%" height="100%">
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
            {days.map((d) => (
              <ReferenceLine
                key={d.i}
                x={d.i}
                stroke="var(--border)"
                label={{ value: DAY.format(d.t * 1000), position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 9 }}
              />
            ))}
            <Tooltip
              cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }}
              content={({ active, payload }) => {
                const pt = active && payload?.[0]?.payload as (typeof points)[number] | undefined;
                if (!pt) return null;
                return (
                  <div className="rounded-md border border-[var(--chart-tooltip-border)] bg-[var(--chart-tooltip-bg)] px-2 py-1 text-xs shadow">
                    <div className="text-[var(--chart-tooltip-muted)]">{TIME.format(pt.t * 1000)} ET</div>
                    <div className="font-semibold text-[var(--chart-tooltip-text)]">
                      {a.name} {pt.p.toFixed(0)}% · {pt.sa.toFixed(1)}–{pt.sb.toFixed(1)}
                    </div>
                  </div>
                );
              }}
            />
            <Area type="monotone" dataKey="p" stroke="var(--foreground)" strokeWidth={1.25} fill={`url(#${id})`} baseValue={50} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[10px] text-[var(--muted)]">
        <span className="truncate">↑ {a.name}</span>
        <span className="truncate">↓ {b.name}</span>
      </div>
    </div>
  );
}
