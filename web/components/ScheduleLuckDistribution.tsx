'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import LazyMount from '@/components/ui/LazyMount';
import SectionCard from '@/components/ui/SectionCard';
import { CHART_THEME } from '@/lib/constants';
import { useTapTooltip } from '@/hooks/useTapTooltip';
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

export default function ScheduleLuckDistribution({ data }: ScheduleLuckDistributionProps) {
  // One popup at a time across the teams' charts
  const tapTooltip = useTapTooltip();
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
          Highlighted bars show each team&apos;s actual win total across the completed regular season weeks.
        </p>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
        {data.teams.map((team) => {
          const chartData = buildChartData(team.outcomes, team.actualWins, minWins, maxWins, winsStep);

          return (
            <div
              key={team.username}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--foreground)]">{team.teamName}</div>
                  <div className="text-xs text-[var(--muted)]">@{team.username}</div>
                </div>
                <div className="text-xs text-[var(--muted)]">
                  Actual wins: <span className="font-semibold text-[var(--foreground)]">{formatWinsLabel(team.actualWins)}</span>
                </div>
              </div>
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
                    <Tooltip active={tapTooltip(team.username).active} content={<ScheduleLuckTooltip />} cursor={{ fill: CHART_THEME.cursor }} />
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
          );
        })}
      </div>
    </SectionCard>
  );
}
