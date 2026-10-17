'use client';

interface PayloadItem {
  dataKey: string;
  value: number;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: PayloadItem[];
  label?: string;
  teams: Array<{ username: string; teamName: string; color: string }>;
  valueFormatter?: (value: number) => string;
  sortDescending?: boolean;
}

export default function CustomTooltip({
  active,
  payload,
  label,
  teams,
  valueFormatter = (value: number) => value.toString(),
  sortDescending = true,
}: CustomTooltipProps) {
  if (!active || !payload || !payload.length) {
    return null;
  }

  // Create array of team data with values
  const teamData = payload.map((entry) => ({
    username: entry.dataKey,
    value: entry.value,
    color: entry.color,
  }));

  // Sort by value
  const sortedTeams = [...teamData].sort((a, b) => {
    return sortDescending ? b.value - a.value : a.value - b.value;
  });

  return (
    <div
      className="bg-[var(--chart-tooltip-bg)] border-2 border-[var(--chart-tooltip-border)] rounded-lg shadow-lg p-4 min-w-[250px] max-w-[300px]"
      style={{ zIndex: 9999, position: 'relative', maxHeight: '500px', display: 'flex', flexDirection: 'column' }}
    >
      <p className="font-bold text-[var(--chart-tooltip-text)] mb-3 text-center border-b border-[var(--chart-tooltip-border)] pb-2 flex-shrink-0">
        {label}
      </p>
      <div className="space-y-1 overflow-y-auto flex-1" style={{ overflowY: 'auto' }}>
        {sortedTeams.map((item) => {
          const team = teams.find((t) => t.username === item.username);
          const teamName = team?.teamName || item.username;

          return (
            <div
              key={item.username}
              className="flex items-center justify-between gap-3 py-1 px-2 rounded hover:bg-[var(--hover)]"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-sm text-[var(--chart-tooltip-muted)] truncate" title={teamName}>
                  {teamName}
                </span>
              </div>
              <span className="text-sm font-semibold text-[var(--chart-tooltip-text)] flex-shrink-0">
                {valueFormatter(item.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
