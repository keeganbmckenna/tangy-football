'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import HowItWorks from '@/components/ui/HowItWorks';
import RetryButton from '@/components/ui/RetryButton';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import { useTableSort } from '@/hooks/useTableSort';
import { sortRows } from '@/lib/tableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { getHeatmapColorByRatio } from '@/lib/constants';
import { formatOdds } from '@/lib/analyze/playoffOdds';
import { hasOverWaiver, netHindsight, tradeLeaders, type SeasonTrade, type TradeSideRef } from '@/lib/analyze/tradeLeaders';
import type { HistoryData, HistoryManager } from '@/lib/analyze/history';
import type { TradeHistoryResponse, TradeHistorySide } from '@/lib/analyze/trade';
import { signed, ppChange } from '@/lib/format';
import LineupWeeks from '@/components/LineupWeeks';

interface TradeHistoryProps {
  history: HistoryData;
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const pp = (d: number) => signed(d * 100);

function Change({ before, after, bad = false }: { before: number; after: number; bad?: boolean }) {
  return (
    <span className="whitespace-nowrap">
      <FromTo before={before} after={after} />
      <Delta before={before} after={after} bad={bad} className="ml-1" />
    </span>
  );
}

function FromTo({ before, after }: { before: number; after: number }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-[var(--muted)]">{formatOdds(before)}</span>
      <span className="mx-1 text-[var(--muted)]">→</span>
      <span className="font-semibold text-[var(--foreground)]">{formatOdds(after)}</span>
    </span>
  );
}

/** The change in percentage points, always shown; grey under half a point (within the simulation's precision) */
function Delta({ before, after, bad = false, className = 'text-right' }: { before: number; after: number; bad?: boolean; className?: string }) {
  const d = (after - before) * 100;
  const moved = Math.abs(d) >= 0.5;
  const tone = !moved ? 'var(--muted)' : (bad ? d < 0 : d > 0) ? 'var(--success-text)' : 'var(--danger-text)';
  return (
    <span className={`whitespace-nowrap text-xs font-semibold tabular-nums ${className}`} style={{ color: tone }}>
      {ppChange(d)}
    </span>
  );
}

/** Odds without the % sign, for tables headed "%" */
const pct = (p: number) => formatOdds(p).replace('%', '');

const HEAD = 'text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]';

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

// The season filter for this visit, so leaving the History tab and coming back keeps it
let rememberedFilter = 'all';

// Managers in the Traders table before "Show all"
const TRADERS_SHOWN = 8;
// Trades listed before "Show all", so the list doesn't bury the sections below it
const COLLAPSED_TRADES = 5;

/** Completed seasons are pre-built; the season in progress is built live */
export async function loadSeason(season: string, complete: boolean) {
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
  // Bumped by "Try again" to re-run the fetch
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilterState] = useState(() => rememberedFilter);
  const setFilter = (f: string) => {
    rememberedFilter = f;
    setFilterState(f);
  };
  const sort = useTableSort('traders');
  const [showAll, setShowAll] = useState(false);
  // The Traders table's top rows (by its current sort), the rest behind Show all
  const [allTraders, setAllTraders] = useState(false);
  // Trade partners grid: a pair of managers whose trades the list shows
  const [pair, setPair] = useState<[string, string] | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const me = useMyTeam();

  const sleeperSeasons = useMemo(() => history.seasons.filter((s) => !s.legacy), [history]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(sleeperSeasons.map((s) => loadSeason(s.season, s.complete)))
      .then((d) => !cancelled && setSeasons(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load trades'));
    return () => {
      cancelled = true;
    };
  }, [sleeperSeasons, attempt]);

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
  // How many times each pair of managers traded
  const partners = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { season, trade } of trades) {
      const ids = [...new Set(trade.sides.map((s) => userOf.id(season, s.rosterId)).filter((id): id is string => !!id))];
      for (const a of ids) for (const b of ids) if (a !== b) counts.set(`${a}|${b}`, (counts.get(`${a}|${b}`) ?? 0) + 1);
    }
    return counts;
  }, [trades, userOf]);
  const listed = pair
    ? trades.filter(({ season, trade }) => {
        const ids = trade.sides.map((s) => userOf.id(season, s.rosterId));
        return ids.includes(pair[0]) && ids.includes(pair[1]);
      })
    : trades;

  const subtitle =
    'Every trade since the league moved to Sleeper: what it did to each team’s odds at the time, and how the players it brought in actually scored.';
  if (error) {
    return (
      <SectionCard title="Trades" subtitle={subtitle} gradientType="secondary">
        <div className="px-6 py-8">
          <p className="text-[var(--muted)]">Couldn&apos;t load trades: {error}</p>
          <RetryButton
            onClick={() => {
              setError(null);
              setAttempt((a) => a + 1);
            }}
          />
        </div>
      </SectionCard>
    );
  }
  if (!seasons) {
    return (
      <SectionCard title="Trades" subtitle={subtitle} gradientType="secondary">
        <LoadingSpinner height={{ phone: 5500, wide: 3400, from: 'md' }} message="Grading trades..." />
      </SectionCard>
    );
  }

  const leaderRows = sortRows(stats.leaders, sort.state, (r, key) =>
    ({ trades: r.trades, playoff: r.playoffOddsGained, title: r.titleOddsGained, points: r.starterPointsOverWaiver, others: r.playoffOddsFromOthers })[key]
  );
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
                {side.atTime.lineupByWeek?.length ? (
                  <LineupWeeks
                    rows={side.atTime.lineupByWeek}
                    summary={<>Projected lineup {signed(side.atTime.lineupPerWeek)} pts/wk</>}
                  />
                ) : (
                  <>Projected lineup {signed(side.atTime.lineupPerWeek)} pts/wk</>
                )}
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
          {side.hindsight.overWaiver !== undefined && side.hindsight.starts > 0 && (
            <div className="text-xs text-[var(--muted)]">
              <span
                className="font-semibold"
                style={{ color: Math.abs(side.hindsight.overWaiver) < 0.05 ? 'var(--muted)' : side.hindsight.overWaiver > 0 ? 'var(--success-text)' : 'var(--danger-text)' }}
              >
                {signed(side.hindsight.overWaiver)}
              </span>{' '}
              over a waiver pickup
            </div>
          )}
        </div>
        <div className="text-sm">
          {side.finalSeed !== null && (
            <span
              className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
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

  // The teams not in a trade, collapsed to a count (half a point or more: less is within the simulation's precision) and your change; every team behind a tap
  const othersRow = (season: string, others: NonNullable<TradeHistoryResponse['trades'][number]['others']>) => {
    const d = (o: (typeof others)[number]) => o.after.playoffs - o.before.playoffs;
    const sorted = [...others].sort((a, b) => Math.abs(d(b)) - Math.abs(d(a)));
    const moved = sorted.filter((o) => Math.abs(d(o)) >= 0.005);
    const who = (rosterId: number) => {
      const id = userOf.id(season, rosterId);
      return { id, name: nameOf(id), mine: !!id && id === me.userId };
    };
    // Your own change, when you weren't in the trade
    const hasTitle = others.some((o) => o.before.champion !== null && o.after.champion !== null);
    const mineO = others.find((o) => who(o.rosterId).mine);
    const myMove = mineO ? ppChange(d(mineO) * 100) : null;
    return (
      <details className="group border-t border-[var(--border)] py-2 text-xs">
        <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
          <span className="shrink-0 font-semibold uppercase tracking-wider text-[var(--muted)]">Everyone else</span>
          <span className="min-w-0 flex-1 text-[var(--muted)]">
            {moved.length === 0
              ? 'no one moved half a point'
              : `${moved.length} team${moved.length === 1 ? '' : 's'} moved half a point+`}
            {myMove !== null && <> <span className="whitespace-nowrap font-semibold text-[var(--foreground)]">· you {myMove}</span></>}
          </span>
          <span className="shrink-0 text-[var(--muted)] transition-transform group-open:rotate-90" aria-hidden="true">›</span>
        </summary>
        {/* One row per team: playoffs before, after and the change, the title's the same. On a narrow phone the
            table scrolls sideways with the names pinned. Numbers without % (the headings say so) to fit a phone */}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs tabular-nums sm:w-auto">
            <thead>
              <tr className={HEAD}>
                <th className="sticky left-0 z-10 bg-[var(--surface-elevated)]" />
                <th colSpan={3} className="border-b border-[var(--border)] px-[3px] pb-0.5 text-center font-semibold sm:px-2">Playoffs %</th>
                {hasTitle && <th colSpan={3} className="border-b border-[var(--border)] px-[3px] pb-0.5 text-center font-semibold sm:px-2">Title %</th>}
              </tr>
              <tr className={HEAD}>
                <th className="sticky left-0 z-10 bg-[var(--surface-elevated)]" />
                {(hasTitle ? [0, 1] : [0]).flatMap((g) =>
                  ['Was', 'Now', '+/−'].map((h) => (
                    <th key={`${g}${h}`} className={`px-[3px] pt-1 text-right font-semibold sm:px-2 ${g === 1 && h === 'Was' ? 'pl-2 sm:pl-5' : ''}`}>
                      {h}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((o) => {
                const w = who(o.rosterId);
                const title = o.before.champion !== null && o.after.champion !== null ? { b: o.before.champion, a: o.after.champion } : null;
                const cells = (x: { b: number; a: number } | null, first: boolean) => (
                  <>
                    <td className={`px-[3px] py-0.5 text-right text-[var(--muted)] sm:px-2 ${first ? '' : 'pl-2 sm:pl-5'}`}>{x ? pct(x.b) : ''}</td>
                    <td className="px-[3px] py-0.5 text-right font-semibold text-[var(--foreground)] sm:px-2">{x ? pct(x.a) : ''}</td>
                    <td className="px-[3px] py-0.5 text-right sm:px-2">{x && <Delta before={x.b} after={x.a} />}</td>
                  </>
                );
                return (
                  <tr key={o.rosterId}>
                    <td
                      className={`sticky left-0 z-10 max-w-[6.25rem] truncate bg-[var(--surface-elevated)] py-0.5 pr-1.5 text-[var(--foreground)] sm:max-w-[12rem] sm:pr-4 ${w.mine ? 'font-semibold' : ''}`}
                      title={w.name}
                    >
                      {w.name}
                    </td>
                    {cells({ b: o.before.playoffs, a: o.after.playoffs }, true)}
                    {hasTitle && cells(title, false)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
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
              <SortStatus sort={sort} className="px-0" />
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                      <th className={`${PIN_TH} !px-3 py-2 font-medium bg-[var(--surface-elevated)]`}>Manager</th>
                      <SortableTh sort={sort} col="trades" className="px-3 py-2 text-center font-medium">Trades</SortableTh>
                      <th className="px-3 py-2 font-medium">Favorite partner</th>
                      <SortableTh sort={sort} col="playoff" tip="Sum of each trade’s change to this manager’s playoff odds the week it went through, in percentage points" className="px-3 py-2 text-center font-medium">Playoff odds at the time</SortableTh>
                      <SortableTh sort={sort} col="title" className="px-3 py-2 text-center font-medium">Title odds at the time</SortableTh>
                      <SortableTh sort={sort} col="points" tip="Points the players they got scored in their starting lineup afterward, minus what a waiver pickup at the same position would have scored in those starts" tipAlign="right" className="px-3 py-2 text-center font-medium">Starter pts over waiver</SortableTh>
                      <SortableTh sort={sort} col="others" tip="Sum of what trades they weren’t in did to their playoff odds the week each went through, in percentage points" tipAlign="right" className="px-3 py-2 text-center font-medium">Playoff odds from others&apos; trades</SortableTh>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {(allTraders ? leaderRows : leaderRows.slice(0, TRADERS_SHOWN)).map((r) => (
                      <tr key={r.userId} className={mineRow(r.userId === me.userId)}>
                        <td className={`${PIN_TD} !px-3 py-2 bg-[var(--surface-elevated)]`}>
                          <span className="block max-w-[7.5rem] truncate font-medium text-[var(--foreground)] sm:max-w-none" title={nameOf(r.userId)}>
                            {nameOf(r.userId)}
                          </span>
                        </td>
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
                        <td className="px-3 py-2 text-center text-[var(--foreground)]">{signed(r.starterPointsOverWaiver)}</td>
                        <td
                          className="px-3 py-2 text-center font-semibold"
                          style={{ color: Math.abs(r.playoffOddsFromOthers) < 0.005 ? 'var(--muted)' : r.playoffOddsFromOthers > 0 ? 'var(--success-text)' : 'var(--danger-text)' }}
                        >
                          {pp(r.playoffOddsFromOthers)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {leaderRows.length > TRADERS_SHOWN && (
                <button
                  type="button"
                  onClick={() => setAllTraders(!allTraders)}
                  className="mt-2 rounded-full border border-[var(--border)] px-3 py-1 text-xs font-semibold text-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  {allTraders ? 'Show fewer' : `Show all (${leaderRows.length})`}
                </button>
              )}
              <HowItWorks className="mt-2" label="What the columns mean">
                <p>
                Odds columns add up each trade&apos;s change in that manager&apos;s odds the week it went through, in percentage
                points (pp). Starter points over waiver are what the players they got scored in their starting lineup
                afterward, minus what a waiver pickup at the same position would have scored in each of those starts (the
                three free agents with the best projections that week, by what they actually scored): a player who started
                a lot counts for his edge over the waiver wire, not for every point.
                </p>
                <p>
                Playoff odds from others&apos; trades adds up what the trades they weren&apos;t in did to their playoff odds, the
                same way. Playoff spots are fixed, so what the two sides of a trade gain comes out of everyone else&apos;s odds:
                mostly the teams chasing the same spots, and the ones about to play the team that got stronger.
                </p>
              </HowItWorks>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {sideList('Biggest playoff odds gains at the time', stats.bestAtTheTime.filter((s) => stats.playoffDelta(s) > 0), (s) => `${pp(stats.playoffDelta(s))} pp`)}
              {sideList('Biggest playoff odds losses at the time', stats.worstAtTheTime.filter((s) => stats.playoffDelta(s) < 0), (s) => `${pp(stats.playoffDelta(s))} pp`)}
              {sideList('Best trades in hindsight', stats.bestHauls, (s) => `${signed(netHindsight(s.trade, s.side), 1)} pts net${hasOverWaiver(s.trade) ? ' over waiver' : ''}`)}
              <div className="rounded-lg border border-[var(--border)] p-4">
                <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">Biggest swings for teams not in the trade</h4>
                {stats.biggestBystanders.filter((b) => Math.abs(b.delta) >= 0.005).length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">None yet.</p>
                ) : (
                  <ol className="space-y-1.5 text-xs">
                    {stats.biggestBystanders.filter((b) => Math.abs(b.delta) >= 0.005).map((b) => (
                      <li key={`${b.season}-${b.trade.id}-${b.rosterId}`} className="flex gap-2">
                        <span className="w-24 shrink-0 font-semibold text-[var(--foreground)]">{pp(b.delta)} pp</span>
                        <span>
                          <span className="text-[var(--foreground)]">{nameOf(b.userId)}</span>
                          <span className="text-[var(--muted)]">
                            {' '}· {b.season} wk {b.trade.week} · {b.trade.sides.map((x) => nameOf(userOf.id(b.season, x.rosterId))).join(' and ')} traded
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>

            {partners.size > 0 && (() => {
              const traders = stats.leaders.map((r) => r.userId).filter((id) => [...partners.keys()].some((k) => k.startsWith(`${id}|`)));
              const most = Math.max(...partners.values());
              return (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">Trade partners ({seasonLabel})</h4>
                  <div className="overflow-x-auto">
                    <table className="text-xs">
                      <thead>
                        <tr>
                          <th className="pin-col sticky left-0 z-10 bg-[var(--surface-elevated)]" />
                          {traders.map((id) => (
                            <th key={id} className="px-0.5 pb-2 font-medium text-[var(--muted)]">
                              <div className="mx-auto w-11 truncate" title={nameOf(id)}>{nameOf(id)}</div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {traders.map((row) => (
                          <tr key={row}>
                            <th className="pin-col sticky left-0 z-10 bg-[var(--surface-elevated)] pr-2 text-left font-medium text-[var(--foreground)]">
                              <div className="w-20 truncate" title={nameOf(row)}>{nameOf(row)}</div>
                            </th>
                            {traders.map((col) => {
                              if (row === col) return <td key={col} className="h-8 w-11 bg-[var(--neutral-bg)]" />;
                              const n = partners.get(`${row}|${col}`) ?? 0;
                              if (!n) return <td key={col} className="h-8 w-11 text-center text-[var(--muted)]">·</td>;
                              const { backgroundColor, textColor } = getHeatmapColorByRatio(0.25 + (0.75 * n) / most);
                              const on = pair?.[0] === row && pair?.[1] === col;
                              return (
                                <td key={col} className="p-0.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPair([row, col]);
                                      listRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                                    }}
                                    className={`heat-cell h-7 w-11 rounded text-center font-semibold ${on ? 'ring-2 ring-[var(--accent)]' : ''}`}
                                    style={{ backgroundColor, color: textColor }}
                                    title={`${nameOf(row)} and ${nameOf(col)}: ${n} trade${n === 1 ? '' : 's'}`}
                                  >
                                    {n}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-xs text-[var(--muted)]">Trades between each pair of managers. Tap a cell for those trades.</p>
                </div>
              );
            })()}

            <div ref={listRef} className="scroll-mt-48">
              <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">
                {pair
                  ? `${nameOf(pair[0])} and ${nameOf(pair[1])}: ${listed.length} trade${listed.length === 1 ? '' : 's'}`
                  : showAll || trades.length <= COLLAPSED_TRADES
                    ? `Every trade (${trades.length})`
                    : `Latest ${COLLAPSED_TRADES} of ${trades.length} trades`}
                {pair && (
                  <button type="button" onClick={() => setPair(null)} className="ml-2 text-xs font-medium text-[var(--muted)] underline hover:text-[var(--foreground)]">
                    Show all
                  </button>
                )}
              </h4>
              <div className="mb-2 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] md:grid">
                <span>Manager</span>
                <span>At the time</span>
                <span>Hindsight</span>
                <span>Finished</span>
              </div>
              <div className="space-y-4">
                {(showAll || pair ? listed : listed.slice(0, COLLAPSED_TRADES)).map(({ season, trade: t }) => (
                  <div key={`${season}-${t.id}`} className="rounded-lg border border-[var(--border)] px-4">
                    <div className="border-b border-[var(--border)] py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                      {season} · Week {t.week}
                      {t.effectiveWeek !== t.week && (
                        <span className="ml-2 font-normal normal-case tracking-normal">went through after that week&apos;s games</span>
                      )}
                    </div>
                    <div className="divide-y divide-[var(--border)]">{t.sides.map((s) => sideRow(season, s))}</div>
                    {t.others && t.others.length > 0 && othersRow(season, t.others)}
                  </div>
                ))}
              </div>
              {!pair && trades.length > COLLAPSED_TRADES && (
                <button
                  type="button"
                  onClick={() => {
                    // Collapsing from the bottom of a long list: go back to its top
                    if (showAll) listRef.current?.scrollIntoView({ block: 'start' });
                    setShowAll(!showAll);
                  }}
                  className="mt-4 w-full rounded-lg border border-[var(--border)] py-2 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--hover)]"
                >
                  {showAll ? 'Show fewer' : `Show all ${trades.length} trades`}
                </button>
              )}
            </div>
          </>
        )}

        <HowItWorks>
          <p>
          At the time: the playoff odds model re-run the week the trade counted from, with that week&apos;s records, rosters and
          projections, without and with the trade (10,000 seasons each, on the same random draws). A trade this week goes by
          each week&apos;s own projection, like the trade tool. An older one carries its week&apos;s projections forward,
          since later weeks&apos; projections now know what happened after it; a player on bye or out that week counts from
          the first week he&apos;s projected to play. The projected lineup change is the raw difference if nothing else changed; a
          test on 28,913 trades in other leagues found that measuring it over the waiver wire instead didn&apos;t make the odds
          more accurate. Hindsight: points the players a team got scored in its starting lineup through the end of that
          regular season (or the latest week, for the season in progress), and the same over a waiver pickup: each start
          less what the three free agents with the best projections at that position that week actually scored, on
          average. A player who started a lot counts for his edge over the waiver wire, not every point.
          </p>
        </HowItWorks>
      </div>
    </SectionCard>
  );
}
