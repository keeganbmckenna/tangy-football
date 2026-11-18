'use client';

import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import LazyMount from '@/components/ui/LazyMount';
import SectionCard from '@/components/ui/SectionCard';
import { CHART_THEME } from '@/lib/constants';
import { useTapTooltip } from '@/hooks/useTapTooltip';
import { ManagerLink } from '@/hooks/useManagerLink';
import { useMyTeam } from '@/hooks/useMyTeam';
import {
  ScheduleLuckSimulation,
  ScheduleLuckDistribution as ScheduleLuckDistributionType,
  ScheduleSimulationOutcome,
} from '@/lib/types';

interface ScheduleLuckDistributionProps {
  data: ScheduleLuckSimulation | null;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: {
      winsLabel: string;
      count: number;
      frequency: number;
    };
  }>;
}

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const ACTUAL_BAR_COLOR = '#f59e0b';
const SIM_BAR_COLOR = '#3b82f6';

const formatWinsLabel = (wins: number) => (Number.isInteger(wins) ? wins.toString() : wins.toFixed(1));

const getMaxFrequency = (teams: ScheduleLuckDistributionType[]) =>
  teams.reduce((max, team) => {
    const teamMax = team.outcomes.reduce((currentMax, outcome) => Math.max(currentMax, outcome.frequency), 0);
    return Math.max(max, teamMax);
  }, 0);

const getWinsDomain = (teams: ScheduleLuckDistributionType[]) => {
  const domain = teams.reduce(
    (current, team) => {
      const teamWins = team.outcomes.map((outcome) => outcome.wins).concat(team.actualWins);
      const teamMin = Math.min(current.min, ...teamWins);
      const teamMax = Math.max(current.max, ...teamWins);
      return { min: teamMin, max: teamMax };
    },
    { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  );

  if (!Number.isFinite(domain.min) || !Number.isFinite(domain.max)) {
    return { min: 0, max: 0 };
  }

  return domain;
};

const getWinsStep = (teams: ScheduleLuckDistributionType[], fallbackStep = 1) => {
  const values = teams.flatMap((team) => team.outcomes.map((outcome) => outcome.wins).concat(team.actualWins));
  const sortedValues = Array.from(new Set(values)).sort((a, b) => a - b);

  if (sortedValues.length < 2) {
    return fallbackStep;
  }

  let minStep = Number.POSITIVE_INFINITY;

  for (let index = 1; index < sortedValues.length; index++) {
    const diff = sortedValues[index] - sortedValues[index - 1];
    if (diff > 0 && diff < minStep) {
      minStep = diff;
    }
  }

  return Number.isFinite(minStep) ? minStep : fallbackStep;
};

const getPaddedWinsDomain = (domain: { min: number; max: number }, step: number) => {
  const padding = step / 2;
  return {
    min: domain.min - padding,
    max: domain.max + padding,
  };
};

const getWinsTicks = (minWins: number, maxWins: number) => {
  const start = Math.ceil(minWins);
  const end = Math.floor(maxWins);

  if (start > end) {
    return [start];
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
};

const normalizeWins = (wins: number) => Number(wins.toFixed(3));

const buildChartData = (
  outcomes: ScheduleSimulationOutcome[],
  actualWins: number,
  minWins: number,
  maxWins: number,
  step: number,
) => {
  const outcomeMap = new Map(outcomes.map((outcome) => [normalizeWins(outcome.wins), outcome]));
  const normalizedActualWins = normalizeWins(actualWins);

  if (!outcomeMap.has(normalizedActualWins)) {
    outcomeMap.set(normalizedActualWins, { wins: actualWins, count: 0, frequency: 0 });
  }

  const bins: ScheduleSimulationOutcome[] = [];
  const totalSteps = Math.floor((maxWins - minWins) / step);

  for (let index = 0; index <= totalSteps; index += 1) {
    const wins = normalizeWins(minWins + step * index);
    const outcome = outcomeMap.get(wins) ?? { wins, count: 0, frequency: 0 };
    bins.push(outcome);
  }

  return bins
    .sort((a, b) => a.wins - b.wins)
    .map((outcome) => ({
      wins: outcome.wins,
      winsLabel: formatWinsLabel(outcome.wins),
      count: outcome.count,
      frequency: outcome.frequency,
      isActual: normalizeWins(outcome.wins) === normalizedActualWins,
    }));
};

function ScheduleLuckTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const data = payload[0].payload;

  return (
    <div className="bg-[var(--chart-tooltip-bg)] border-2 border-[var(--chart-tooltip-border)] rounded-lg shadow-lg p-3">
      <p className="font-bold text-[var(--chart-tooltip-text)] mb-1">{data.winsLabel} wins</p>
      <p className="text-sm text-[var(--chart-tooltip-muted)]">
        {data.count} sims • {formatPercent(data.frequency)}
      </p>
    </div>
  );
}

/** The wins below which this share of schedules fall */
const quantile = (outcomes: ScheduleSimulationOutcome[], q: number) => {
  let cum = 0;
  for (const o of [...outcomes].sort((a, b) => a.wins - b.wins)) {
    cum += o.frequency;
    if (cum >= q - 1e-9) return o.wins;
  }
  return outcomes[outcomes.length - 1]?.wins ?? 0;
};

/** Share of schedules that would have given fewer wins than it got (ties half) */
const luckierThan = (team: ScheduleLuckDistributionType) =>
  team.outcomes.reduce((s, o) => s + (o.wins < team.actualWins ? o.frequency : o.wins === team.actualWins ? o.frequency / 2 : 0), 0);

export default function ScheduleLuckDistribution({ data }: ScheduleLuckDistributionProps) {
  // One popup at a time across the teams' charts
  const tapTooltip = useTapTooltip();
  const me = useMyTeam();
  // Teams the viewer flipped from where they start (your team starts open, the rest closed)
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  if (!data || data.teams.length === 0) {
    return null;
  }

  const maxFrequency = getMaxFrequency(data.teams);
  const yAxisMax = Math.min(1, maxFrequency * 1.05);
  const winsDomain = getWinsDomain(data.teams);
  const winsStep = getWinsStep(data.teams);
  const { min: xAxisMin, max: xAxisMax } = getPaddedWinsDomain(winsDomain, winsStep);
  const { min: minWins, max: maxWins } = winsDomain;
  const xAxisTicks = getWinsTicks(minWins, maxWins);

  return (
    <SectionCard
      title="Schedule Luck Distribution"
      subtitle={`Randomized schedules (${data.simulations.toLocaleString()} sims) over ${data.weeksSimulated} weeks with round-robin + repeat opening weeks`}
      gradientType="warning"
      footer={
        <p className="text-xs text-[var(--muted)]">
          Each row&apos;s bar is the middle 80% of win totals over the shuffled schedules and the dot is what happened; luckier
          than is the share of schedules that would have given fewer wins. Tap a team for every total: the highlighted bar is its
          actual wins across the completed regular-season weeks.
        </p>
      }
    >
      {/* One row a team: the middle 80% of its schedules (bar) and what happened (dot); tap for the whole distribution */}
      <ul className="divide-y divide-[var(--border)]">
        {data.teams.map((team) => {
          const chartData = buildChartData(team.outcomes, team.actualWins, minWins, maxWins, winsStep);
          const lo = quantile(team.outcomes, 0.1);
          const hi = quantile(team.outcomes, 0.9);
          const x = (w: number) => `${maxWins > minWins ? ((w - minWins) / (maxWins - minWins)) * 100 : 50}%`;
          const isOpen = flipped.has(team.username) !== (team.username === me.username);
          const share = luckierThan(team);
          const toggle = () =>
            setFlipped((prev) => {
              const next = new Set(prev);
              if (next.has(team.username)) next.delete(team.username);
              else next.add(team.username);
              return next;
            });

          return (
            <li key={team.username}>
              <button
                type="button"
                onClick={toggle}
                aria-expanded={isOpen}
                className="grid w-full grid-cols-[1rem_minmax(0,7.5rem)_1fr_4.5rem] items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--hover)] sm:grid-cols-[1rem_12rem_1fr_7rem] sm:px-6"
              >
                <span aria-hidden className={`text-[var(--muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--foreground)]">{team.teamName}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{formatWinsLabel(team.actualWins)} wins</span>
                </span>
                <span
                  className="relative h-4"
                  role="img"
                  aria-label={`${team.teamName}: ${formatWinsLabel(team.actualWins)} wins; 80% of schedules give ${formatWinsLabel(lo)} to ${formatWinsLabel(hi)}`}
                >
                  <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
                  <span className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full opacity-40" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})`, backgroundColor: SIM_BAR_COLOR, minWidth: 4 }} />
                  <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface-elevated)]" style={{ left: x(team.actualWins), backgroundColor: ACTUAL_BAR_COLOR }} />
                </span>
                <span className="text-right text-xs tabular-nums text-[var(--muted)]">
                  luckier than <span className="font-semibold text-[var(--foreground)]">{Math.round(share * 100)}%</span>
                </span>
              </button>
              {isOpen && (
            <div className="px-4 pb-4 sm:px-6">
              <div className="mb-2 text-xs text-[var(--muted)]"><ManagerLink username={team.username} /></div>
              <LazyMount height={220}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 16 }} {...tapTooltip(team.username).chartProps}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis
                      dataKey="wins"
                      type="number"
                      tick={{ fill: CHART_THEME.tick }}
                      axisLine={{ stroke: CHART_THEME.axis }}
                      tickLine={{ stroke: CHART_THEME.axis }}
                      tickFormatter={formatWinsLabel}
                      domain={[xAxisMin, xAxisMax]}
                      ticks={xAxisTicks}
                      allowDecimals={false}
                      style={{ fontSize: '11px' }}
                    />
                    <YAxis
                      tick={{ fill: CHART_THEME.tick }}
                      axisLine={{ stroke: CHART_THEME.axis }}
                      tickLine={{ stroke: CHART_THEME.axis }}
                      tickFormatter={formatPercent}
                      domain={[0, yAxisMax]}
                      style={{ fontSize: '11px' }}
                    />
                    <Tooltip isAnimationActive={false} active={tapTooltip(team.username).active} content={<ScheduleLuckTooltip />} cursor={{ fill: CHART_THEME.cursor }} />
                    <Bar isAnimationActive={false} dataKey="frequency" minPointSize={1}>
                      {chartData.map((entry) => {
                        const fillColor = entry.isActual
                          ? ACTUAL_BAR_COLOR
                          : entry.frequency === 0
                          ? 'transparent'
                          : SIM_BAR_COLOR;

                        return <Cell key={entry.winsLabel} fill={fillColor} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </LazyMount>
            </div>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
