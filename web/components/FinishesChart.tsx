'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import LazyMount from '@/components/ui/LazyMount';
import SectionCard from '@/components/ui/SectionCard';
import { CHART_CONFIG, CHART_THEME, TEAM_COLORS } from '@/lib/constants';
import { useChartHover } from '@/hooks/useChartHover';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { seasonFinishes, type HistoryData, type SeasonFinish } from '@/lib/analyze/history';

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** The champion, runner-up, third place and toilet bowl loser get an icon on the chart */
const icon = (f?: SeasonFinish) => (!f ? null : f.toiletLoser ? '💩' : f.exact ? ({ 1: '🏆', 2: '🥈', 3: '🥉' } as Record<number, string>)[f.place] ?? null : null);

interface Series {
  userId: string;
  name: string;
  color: string;
  /** Not in the current season's league */
  former: boolean;
}

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: { season: string };
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
}

/** Every manager's final place each season, with the podium and the toilet bowl marked */
export default function FinishesChart({ data }: { data: HistoryData }) {
  const { setHoveredItem, clearHovered, isHovered, isOtherHovered } = useChartHover<string>();
  const me = useMyTeam();
  const tap = useTapTooltip()();

  const { seasons, finishes, series, rows, maxPlace, approx } = useMemo(() => {
    const { seasons, finishes } = seasonFinishes(data);
    const current = new Set(data.seasons[0]?.teams.map((t) => t.userId) ?? []);
    const names = new Map(data.managers.map((m) => [m.userId, m.firstName ?? m.name]));
    // Current managers first, then those who've left; alphabetical within each
    const ids = Object.keys(finishes).sort(
      (a, b) => Number(!current.has(a)) - Number(!current.has(b)) || (names.get(a) ?? a).localeCompare(names.get(b) ?? b)
    );
    const series: Series[] = ids.map((id, i) => ({
      userId: id,
      name: names.get(id) ?? id,
      color: TEAM_COLORS[i % TEAM_COLORS.length],
      former: !current.has(id),
    }));
    const rows = seasons.map((season) => ({
      season,
      ...Object.fromEntries(ids.map((id) => [id, finishes[id][season]?.place ?? null])),
    }));
    const maxPlace = Math.max(...ids.flatMap((id) => Object.values(finishes[id]).map((f) => f.place)));
    const approx = ids.some((id) => Object.values(finishes[id]).some((f) => !f.exact));
    return { seasons, finishes, series, rows, maxPlace, approx };
  }, [data]);

  if (seasons.length < 2) return null;
  const byId = new Map(series.map((s) => [s.userId, s]));

  const renderDot = (s: Series) =>
    function PlaceDot({ cx, cy, payload }: DotProps) {
      const f = payload ? finishes[s.userId]?.[payload.season] : undefined;
      if (cx == null || cy == null || !f || isOtherHovered(s.userId)) return <g />;
      const emoji = icon(f);
      if (emoji) {
        return (
          // dy rather than dominant-baseline, which emoji ignore in some browsers
          <text x={cx} y={cy} dy="0.35em" textAnchor="middle" fontSize={isHovered(s.userId) ? 24 : 19}>
            {emoji}
          </text>
        );
      }
      // Hollow before Sleeper below the top three, where the place is from the regular season
      return <circle cx={cx} cy={cy} r={CHART_CONFIG.dotRadius.default} stroke={s.color} strokeWidth={1.5} fill={f.exact ? s.color : 'var(--background)'} />;
    };

  const FinishTooltip = ({ active, label, payload }: TooltipProps) => {
    if (!active || !payload?.length || !label) return null;
    const list = payload
      .map((p) => ({ s: byId.get(p.dataKey), f: finishes[p.dataKey]?.[label] }))
      .filter((x): x is { s: Series; f: SeasonFinish } => !!x.s && !!x.f)
      .sort((a, b) => a.f.place - b.f.place);
    return (
      <div className="min-w-[220px] max-w-[280px] rounded-lg border-2 border-[var(--chart-tooltip-border)] bg-[var(--chart-tooltip-bg)] p-3 shadow-lg">
        <p className="mb-2 border-b border-[var(--chart-tooltip-border)] pb-2 text-center font-bold text-[var(--chart-tooltip-text)]">{label}</p>
        <div className="space-y-0.5">
          {list.map(({ s, f }) => (
            <div key={s.userId} className="flex items-center gap-2 px-1 text-sm">
              <span className="w-9 shrink-0 text-right font-semibold tabular-nums text-[var(--chart-tooltip-text)]">
                {f.exact ? ordinal(f.place) : `~${ordinal(f.place)}`}
              </span>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="truncate text-[var(--chart-tooltip-muted)]">{s.name}</span>
              <span className="ml-auto shrink-0">{icon(f)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <SectionCard
      title="Finishes by Season"
      subtitle="Each manager's final place every season: 🏆 champion, 🥈 runner-up, 🥉 third, 💩 toilet bowl loser"
      gradientType="accent"
    >
      <div className="p-4 sm:p-6">
        <LazyMount height={CHART_CONFIG.defaultHeight}>
          <ResponsiveContainer width="100%" height={CHART_CONFIG.defaultHeight}>
            <LineChart data={rows} margin={{ top: 18, right: 16, left: 0, bottom: 8 }} {...tap.chartProps}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
              <XAxis
                dataKey="season"
                padding={{ left: 16, right: 16 }}
                tick={{ fill: CHART_THEME.tick }}
                axisLine={{ stroke: CHART_THEME.axis }}
                tickLine={{ stroke: CHART_THEME.axis }}
              />
              <YAxis
                reversed
                domain={[1, maxPlace]}
                ticks={Array.from({ length: maxPlace }, (_, i) => i + 1)}
                tickFormatter={ordinal}
                width={44}
                tick={{ fill: CHART_THEME.tick }}
                axisLine={{ stroke: CHART_THEME.axis }}
                tickLine={{ stroke: CHART_THEME.axis }}
              />
              <Tooltip active={tap.active} cursor={{ stroke: CHART_THEME.axis, strokeWidth: 1 }} content={<FinishTooltip />} wrapperStyle={{ zIndex: 9999 }} />
              <Legend
                onMouseEnter={(e) => setHoveredItem(e.dataKey as string)}
                onMouseLeave={clearHovered}
                wrapperStyle={{ color: CHART_THEME.legend }}
              />
              {series.map((s) => (
                <Line
                  key={s.userId}
                  isAnimationActive={false}
                  type="linear"
                  dataKey={s.userId}
                  name={s.former ? `${s.name} (former)` : s.name}
                  stroke={s.color}
                  strokeDasharray={s.former ? '4 4' : undefined}
                  strokeWidth={isHovered(s.userId) || s.userId === me.userId ? CHART_CONFIG.strokeWidth.hovered : CHART_CONFIG.strokeWidth.default}
                  strokeOpacity={isOtherHovered(s.userId) ? 0 : 1}
                  dot={renderDot(s)}
                  activeDot={isOtherHovered(s.userId) ? false : { r: CHART_CONFIG.dotRadius.active }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </LazyMount>
      </div>
      {approx && (
        <p className="px-4 pb-4 text-xs text-[var(--muted)] sm:px-6">
          Before Sleeper (2017–2021) only the top three were recorded, so the rest are placed by regular-season standing (hollow points, ~ in the
          popup). Dashed lines are managers no longer in the league.
        </p>
      )}
    </SectionCard>
  );
}
