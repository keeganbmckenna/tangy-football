'use client';

import { useEffect, useMemo, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { formatOdds } from '@/lib/analyze/playoffOdds';
import { tradeLeaders, type SeasonTrade, type TradeSideRef } from '@/lib/analyze/tradeLeaders';
import type { HistoryData, HistoryManager } from '@/lib/analyze/history';
import type { TradeHistoryResponse, TradeHistorySide } from '@/lib/analyze/trade';

interface TradeHistoryProps {
  history: HistoryData;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const pp = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}`;

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

function Avatar({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" onError={() => setFailed(true)} className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--neutral-bg)] text-xs font-semibold text-[var(--neutral-text)]">
      {name.charAt(0)}
    </div>
  );
}

/** Completed seasons are pre-built; the season in progress is built live */
async function loadSeason(season: string, complete: boolean) {
  if (complete) {
    const res = await fetch(`/data/trades/${season}.json`).catch(() => null);
    if (res?.ok) return (await res.json()) as TradeHistoryResponse;
  }
  const res = await fetch(`/api/trades/${season}`);
  if (!res.ok) throw new Error(`Failed to load ${season} trades`);
  return (await res.json()) as TradeHistoryResponse;
}

/** Every Sleeper season's trades, graded, with all-time trade stats by manager */
export default function TradeHistory({ history }: TradeHistoryProps) {
  const [seasons, setSeasons] = useState<TradeHistoryResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  const sleeperSeasons = useMemo(() => history.seasons.filter((s) => !s.legacy), [history]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(sleeperSeasons.map((s) => loadSeason(s.season, s.complete)))
      .then((d) => !cancelled && setSeasons(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load trades'));
    return () => {
      cancelled = true;
    };
  }, [sleeperSeasons]);

  const managers = useMemo(() => new Map(history.managers.map((m) => [m.userId, m])), [history]);
  const userOf = useMemo(() => {
    const byRoster = new Map(sleeperSeasons.flatMap((s) => s.teams.map((t) => [`${s.season}:${t.rosterId}`, t] as const)));
    return {
      team: (season: string, rosterId: number) => byRoster.get(`${season}:${rosterId}`),
      id: (season: string, rosterId: number) => byRoster.get(`${season}:${rosterId}`)?.userId ?? null,
    };
  }, [sleeperSeasons]);

  const shown = useMemo(() => (seasons ?? []).filter((s) => filter === 'all' || s.season === filter), [seasons, filter]);
  const trades: SeasonTrade[] = useMemo(
    () => shown.flatMap((s) => [...s.trades].reverse().map((trade) => ({ season: s.season, trade }))),
    [shown]
  );
  const stats = useMemo(() => tradeLeaders(trades, userOf.id), [trades, userOf]);

  const subtitle =
    'Every trade since the league moved to Sleeper: what it did to each team’s odds at the time, and how the players it brought in actually scored.';
  if (error) {
    return (
      <SectionCard title="Trades" subtitle={subtitle} gradientType="secondary">
        <p className="px-6 py-8 text-[var(--muted)]">Couldn&apos;t load trades: {error}</p>
      </SectionCard>
    );
  }
  if (!seasons) {
    return (
      <SectionCard title="Trades" subtitle={subtitle} gradientType="secondary">
        <LoadingSpinner message="Grading trades..." />
      </SectionCard>
    );
  }

  const bySeason = new Map(seasons.map((s) => [s.season, s]));
  const players = Object.assign({}, ...seasons.map((s) => s.players)) as TradeHistoryResponse['players'];
  const nameOf = (id: string | null) => (id ? managers.get(id)?.name ?? 'Unknown' : '—');
  const got = (side: TradeHistorySide) => [
    ...side.receives.map((p) => {
      const info = players[p];
      return info ? `${info.name}${info.position ? ` (${info.position})` : ''}` : p;
    }),
    ...side.picks.map((p) => `${p} pick`),
    ...(side.faab > 0 ? [`$${side.faab} FAAB`] : []),
  ];

  const sideRow = (season: string, side: TradeHistorySide) => {
    const team = userOf.team(season, side.rosterId);
    const m: HistoryManager | undefined = team ? managers.get(team.userId) : undefined;
    const data = bySeason.get(season)!;
    const items = got(side);
    return (
      <div key={side.rosterId} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] md:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar url={team?.avatarUrl ?? m?.avatarUrl ?? null} name={m?.name ?? '?'} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--foreground)]">
              {m?.name ?? `Team ${side.rosterId}`}
              {team && <span className="ml-1.5 font-normal text-[var(--muted)]">{team.teamName.trim()}</span>}
            </div>
            <div className="text-xs text-[var(--muted)]">Got {items.length ? items.join(', ') : 'nothing'}</div>
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
  };

  const sideList = (title: string, items: TradeSideRef[], value: (s: TradeSideRef) => string) => (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{title}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">None yet.</p>
      ) : (
        <ol className="space-y-1.5 text-xs">
          {items.map((s) => (
            <li key={`${s.trade.id}-${s.side.rosterId}`} className="flex gap-2">
              <span className="w-24 shrink-0 font-semibold text-[var(--foreground)]">{value(s)}</span>
              <span>
                <span className="text-[var(--foreground)]">{nameOf(s.userId)}</span>
                <span className="text-[var(--muted)]">
                  {' '}· {s.season} wk {s.trade.week} · got {got(s.side).join(', ') || 'nothing'}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  const seasonLabel = filter === 'all' ? 'all-time' : filter;
  const chip = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFilter(id)}
      aria-pressed={filter === id}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        filter === id ? 'bg-[var(--accent)] text-white' : 'bg-[var(--neutral-bg)] text-[var(--neutral-text)] hover:opacity-80'
      }`}
    >
      {label}
    </button>
  );

  return (
    <SectionCard title="Trades" subtitle={subtitle} gradientType="secondary">
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap gap-2">
          {chip('all', 'All seasons')}
          {seasons.map((s) => chip(s.season, `${s.season} (${s.trades.length})`))}
        </div>

        {trades.length === 0 ? (
          <p className="py-4 text-[var(--muted)]">No trades{filter === 'all' ? ' yet' : ` in ${filter}`}.</p>
        ) : (
          <>
            <div>
              <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">Traders ({seasonLabel})</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                      <th className="px-3 py-2 font-medium">Manager</th>
                      <th className="px-3 py-2 text-center font-medium">Trades</th>
                      <th className="px-3 py-2 font-medium">Favorite partner</th>
                      <th className="px-3 py-2 text-center font-medium">Playoff odds at the time</th>
                      <th className="px-3 py-2 text-center font-medium">Title odds at the time</th>
                      <th className="px-3 py-2 text-center font-medium">Starter pts received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {stats.leaders.map((r) => (
                      <tr key={r.userId}>
                        <td className="px-3 py-2 font-medium text-[var(--foreground)]">{nameOf(r.userId)}</td>
                        <td className="px-3 py-2 text-center text-[var(--foreground)]">{r.trades}</td>
                        <td className="px-3 py-2 text-[var(--foreground)]">
                          {r.topPartner ? (
                            <>
                              {nameOf(r.topPartner.userId)}
                              <span className="text-xs text-[var(--muted)]"> ({r.topPartner.trades})</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        {[r.playoffOddsGained, r.titleOddsGained].map((d, i) => (
                          <td
                            key={i}
                            className="px-3 py-2 text-center font-semibold"
                            style={{ color: Math.abs(d) < 0.005 ? 'var(--muted)' : d > 0 ? 'var(--success-text)' : 'var(--danger-text)' }}
                          >
                            {pp(d)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center text-[var(--foreground)]">{r.starterPoints.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Odds columns add up each trade&apos;s change in that manager&apos;s odds the week it went through, in percentage
                points (pp). Starter points are what the players they got scored in their starting lineup afterward.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sideList('Biggest playoff odds gains at the time', stats.bestAtTheTime.filter((s) => stats.playoffDelta(s) > 0), (s) => `${pp(stats.playoffDelta(s))} pp`)}
              {sideList('Biggest playoff odds losses at the time', stats.worstAtTheTime.filter((s) => stats.playoffDelta(s) < 0), (s) => `${pp(stats.playoffDelta(s))} pp`)}
              {sideList('Best hauls in hindsight', stats.bestHauls, (s) => `${s.side.hindsight.points.toFixed(1)} pts`)}
            </div>

            <div>
              <div className="mb-2 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] md:grid">
                <span>Manager</span>
                <span>At the time</span>
                <span>Hindsight</span>
                <span>Finished</span>
              </div>
              <div className="space-y-4">
                {trades.map(({ season, trade: t }) => (
                  <div key={`${season}-${t.id}`} className="rounded-lg border border-[var(--border)] px-4">
                    <div className="border-b border-[var(--border)] py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {season} · Week {t.week}
                      {t.effectiveWeek !== t.week && (
                        <span className="ml-2 font-normal normal-case tracking-normal">went through after that week&apos;s games</span>
                      )}
                    </div>
                    <div className="divide-y divide-[var(--border)]">{t.sides.map((s) => sideRow(season, s))}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <p className="text-xs text-[var(--muted)]">
          At the time: the playoff odds model re-run the week the trade counted from, with that week&apos;s records, rosters and
          projections, without and with the trade (5,000 seasons each, on the same random draws). The projected lineup change
          is the raw difference if nothing else changed. Hindsight: points the players a team got scored in its starting
          lineup through the end of that regular season (or the latest week, for the season in progress).
        </p>
      </div>
    </SectionCard>
  );
}
