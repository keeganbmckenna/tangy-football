'use client';

import { useEffect, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { formatOdds } from '@/lib/analyze/playoffOdds';
import type { TradeHistoryResponse, TradeHistorySide } from '@/lib/analyze/trade';
import type { TeamStats } from '@/lib/types';

interface TradeHistoryProps {
  season: string;
  isCurrentSeason: boolean;
  teamStats: TeamStats[];
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

function Change({ before, after, bad = false }: { before: number; after: number; bad?: boolean }) {
  const d = (after - before) * 100;
  const tone = Math.abs(d) < 0.5 ? 'var(--muted)' : (bad ? d < 0 : d > 0) ? 'var(--success-text)' : 'var(--danger-text)';
  return (
    <span className="whitespace-nowrap">
      <span className="text-[var(--muted)]">{formatOdds(before)}</span>
      <span className="mx-1 text-[var(--muted)]">→</span>
      <span className="font-semibold text-[var(--foreground)]">{formatOdds(after)}</span>
      <span className="ml-1 text-xs font-semibold" style={{ color: tone }}>
        {Math.abs(d) < 0.5 ? '~0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(Math.abs(d) < 10 ? 1 : 0)}`}
      </span>
    </span>
  );
}

function Avatar({ team }: { team?: TeamStats }) {
  const [failed, setFailed] = useState(false);
  if (team?.avatarUrl && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={team.avatarUrl} alt="" onError={() => setFailed(true)} className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--neutral-bg)] text-xs font-semibold text-[var(--neutral-text)]">
      {(team?.teamName ?? '?').charAt(0)}
    </div>
  );
}

function SideRow({
  side,
  team,
  data,
}: {
  side: TradeHistorySide;
  team?: TeamStats;
  data: TradeHistoryResponse;
}) {
  const got = [
    ...side.receives.map((p) => {
      const info = data.players[p];
      return info ? `${info.name}${info.position ? ` (${info.position})` : ''}` : p;
    }),
    ...side.picks.map((p) => `${p} pick`),
    ...(side.faab > 0 ? [`$${side.faab} FAAB`] : []),
  ];
  return (
    <div className="grid gap-3 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] md:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar team={team} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--foreground)]">
            {team?.teamName.trim() ?? `Team ${side.rosterId}`}
            {team?.username && <span className="ml-1.5 font-normal text-[var(--muted)]">{team.username}</span>}
          </div>
          <div className="text-xs text-[var(--muted)]">Got {got.length ? got.join(', ') : 'nothing'}</div>
        </div>
      </div>
      <div className="text-sm">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] md:hidden">At the time</div>
        {side.atTime ? (
          <div className="space-y-0.5">
            <div>
              <span className="mr-1 text-xs text-[var(--muted)]">Playoffs</span>
              <Change before={side.atTime.before.playoffs} after={side.atTime.after.playoffs} />
            </div>
            {side.atTime.before.champion !== null && side.atTime.after.champion !== null && (
              <div>
                <span className="mr-1 text-xs text-[var(--muted)]">Title</span>
                <Change before={side.atTime.before.champion} after={side.atTime.after.champion} />
              </div>
            )}
            {side.atTime.before.lastPlace !== null && side.atTime.after.lastPlace !== null && (
              <div>
                <span className="mr-1 text-xs text-[var(--muted)]">Lose toilet bowl</span>
                <Change before={side.atTime.before.lastPlace} after={side.atTime.after.lastPlace} bad />
              </div>
            )}
            <div className="text-xs text-[var(--muted)]">
              Projected lineup {side.atTime.lineupPerWeek >= 0 ? '+' : '−'}
              {Math.abs(side.atTime.lineupPerWeek).toFixed(1)} pts/wk
            </div>
          </div>
        ) : (
          <span className="text-xs text-[var(--muted)]">Not available</span>
        )}
      </div>
      <div className="text-sm">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] md:hidden">Hindsight</div>
        <span className="font-semibold text-[var(--foreground)]">{side.hindsight.points.toFixed(1)} pts</span>
        <span className="text-xs text-[var(--muted)]">
          {' '}in {side.hindsight.starts} start{side.hindsight.starts === 1 ? '' : 's'}
        </span>
      </div>
      <div className="text-sm">
        {side.finalSeed !== null && (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={
              side.finalSeed <= data.playoffTeams
                ? { backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }
                : { backgroundColor: 'var(--neutral-bg)', color: 'var(--neutral-text)' }
            }
          >
            {side.finalSeed <= data.playoffTeams ? `Playoffs, ${ordinal(side.finalSeed)} seed` : `Missed, ${ordinal(side.finalSeed)}`}
          </span>
        )}
      </div>
    </div>
  );
}

export default function TradeHistory({ season, isCurrentSeason, teamStats }: TradeHistoryProps) {
  const [data, setData] = useState<TradeHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    const load = async () => {
      // Completed seasons are pre-built; the season in progress is built live
      if (!isCurrentSeason) {
        const res = await fetch(`/data/trades/${season}.json`).catch(() => null);
        if (res?.ok) return (await res.json()) as TradeHistoryResponse;
      }
      const res = await fetch(`/api/trades/${season}`);
      if (!res.ok) throw new Error('Failed to load trades');
      return (await res.json()) as TradeHistoryResponse;
    };
    load()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load trades'));
    return () => {
      cancelled = true;
    };
  }, [season, isCurrentSeason]);

  const team = (id: number) => teamStats.find((t) => t.rosterId === id);

  return (
    <SectionCard
      title="Trade History"
      subtitle={`Every completed ${season} trade: what it did to each team's odds at the time, and how the players it brought in actually scored.`}
      gradientType="secondary"
    >
      {error ? (
        <p className="px-6 py-8 text-[var(--muted)]">Couldn&apos;t load trades: {error}</p>
      ) : !data ? (
        <LoadingSpinner message="Grading trades..." />
      ) : data.trades.length === 0 ? (
        <p className="px-6 py-8 text-[var(--muted)]">No trades in {season}.</p>
      ) : (
        <div className="p-4 sm:p-6">
          <div className="mb-2 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] md:grid">
            <span>Team</span>
            <span>At the time</span>
            <span>Hindsight</span>
            <span>{data.complete ? 'Finished' : ''}</span>
          </div>
          <div className="space-y-4">
            {[...data.trades].reverse().map((t) => (
              <div key={t.id} className="rounded-lg border border-[var(--border)] px-4">
                <div className="border-b border-[var(--border)] py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Week {t.week}
                  {t.effectiveWeek !== t.week && (
                    <span className="ml-2 font-normal normal-case tracking-normal">went through after that week&apos;s games</span>
                  )}
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {t.sides.map((s) => (
                    <SideRow key={s.rosterId} side={s} team={team(s.rosterId)} data={data} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-[var(--muted)]">
            At the time: the playoff odds model re-run the week the trade counted from, with that week&apos;s records, rosters
            and projections, without and with the trade (5,000 seasons each, on the same random draws). The projected lineup
            change is the raw difference if nothing else changed. Hindsight: points the players a team got scored in its
            starting lineup through week {data.throughWeek}.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
