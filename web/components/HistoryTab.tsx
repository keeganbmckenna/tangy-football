'use client';

import { useEffect, useMemo, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import RetryButton from '@/components/ui/RetryButton';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import { useTableSort } from '@/hooks/useTableSort';
import { recordValue, sortRows } from '@/lib/tableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import TradeHistory from '@/components/TradeHistory';
import { getHeatmapColorByRatio } from '@/lib/constants';
import {
  allTimeStandings,
  headToHead,
  recordBook,
  rivalries,
  type GameRecord,
  type HistoryData,
  type HistoryGame,
  type HistoryManager,
  type SeasonRecord,
} from '@/lib/analyze/history';

const MIN_SERIES = 4;

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const record = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ''}`;
const KIND_LABEL: Record<HistoryGame['kind'], string> = {
  regular: '',
  playoff: 'Playoffs',
  placement: 'Placement game',
  consolation: 'Consolation',
  toilet: 'Toilet bowl',
};

function Avatar({ m, size = 8 }: { m?: HistoryManager; size?: number }) {
  const [failed, setFailed] = useState(false);
  const cls = size === 8 ? 'h-8 w-8' : 'h-6 w-6';
  if (m?.avatarUrl && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={m.avatarUrl} alt="" onError={() => setFailed(true)} className={`${cls} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <div className={`${cls} flex shrink-0 items-center justify-center rounded-full bg-[var(--neutral-bg)] text-xs font-semibold text-[var(--neutral-text)]`}>
      {(m?.name ?? '?').charAt(0)}
    </div>
  );
}

export default function HistoryTab() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the fetch
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<[string, string] | null>(null);
  const standingsSort = useTableSort('allTimeStandings');
  const me = useMyTeam();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/history')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load league history');
        return res.json() as Promise<HistoryData>;
      })
      .then((json) => !cancelled && setData(json))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load league history'));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const derived = useMemo(() => {
    if (!data) return null;
    const standings = allTimeStandings(data);
    return { standings, h2h: headToHead(data), rivals: rivalries(data), records: recordBook(data) };
  }, [data]);

  if (error) {
    return (
      <SectionCard title="League History" gradientType="primary">
        <div className="px-6 py-8">
          <p className="text-[var(--muted)]">Couldn&apos;t load the league history: {error}</p>
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
  if (!data || !derived) return <LoadingSpinner message="Loading every season..." />;

  const managers = new Map(data.managers.map((m) => [m.userId, m]));
  const current = new Set(data.seasons[0]?.teams.map((t) => t.userId) ?? []);
  const nameOf = (id: string | null) => (id ? managers.get(id)?.name ?? 'Unknown' : '—');
  const teamIn = (season: string, id: string | null) => data.seasons.find((s) => s.season === season)?.teams.find((t) => t.userId === id);
  const { standings, h2h, rivals, records } = derived;
  // Matrix order: current managers by all-time win %, then former ones
  // (managers from before Sleeper only have no games to show)
  const order = [...standings]
    .filter((r) => h2h[r.userId])
    .sort((a, b) => Number(current.has(b.userId)) - Number(current.has(a.userId)))
    .map((r) => r.userId);

  const person = (id: string | null, season?: string) => {
    const m = id ? managers.get(id) : undefined;
    const team = season ? teamIn(season, id) : undefined;
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Avatar m={team ? { ...m!, avatarUrl: team.avatarUrl ?? m?.avatarUrl ?? null } : m} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--foreground)]">{nameOf(id)}</div>
          {team && <div className="truncate text-xs text-[var(--muted)]">{team.teamName}</div>}
        </div>
      </div>
    );
  };

  const gameLine = (g: HistoryGame, me?: string) => {
    const [x, y, px, py] = me === g.b ? [g.b, g.a, g.pb, g.pa] : [g.a, g.b, g.pa, g.pb];
    return (
      <span>
        <span className="text-[var(--muted)]">{g.season} wk {g.week}{KIND_LABEL[g.kind] ? ` · ${KIND_LABEL[g.kind]}` : ''}:</span>{' '}
        <span className={px > py ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--foreground)]'}>{nameOf(x)} {px.toFixed(2)}</span>
        <span className="text-[var(--muted)]"> – </span>
        <span className={py > px ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--foreground)]'}>{py.toFixed(2)} {nameOf(y)}</span>
      </span>
    );
  };

  const gameList = (title: string, items: GameRecord[]) => (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{title}</h4>
      <ol className="space-y-1.5 text-xs">
        {items.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-14 shrink-0 font-semibold text-[var(--foreground)]">{r.value.toFixed(2)}</span>
            {gameLine(r.game, r.userId)}
          </li>
        ))}
      </ol>
    </div>
  );

  const seasonList = (title: string, items: SeasonRecord[], show: 'record' | 'points') => (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{title}</h4>
      <ol className="space-y-1.5 text-xs">
        {items.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-14 shrink-0 font-semibold text-[var(--foreground)]">
              {show === 'record' ? record(r.wins, r.losses, r.ties) : (r.pointsPerGame ?? 0).toFixed(1)}
            </span>
            <span className="text-[var(--foreground)]">{nameOf(r.userId)}</span>
            <span className="text-[var(--muted)]">
              {r.season}
              {show === 'record'
                ? r.pointsPerGame !== null ? ` · ${r.pointsPerGame.toFixed(1)} ppg` : ''
                : ` ppg · ${record(r.wins, r.losses, r.ties)}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );

  const series = rivals.filter((r) => r.games >= MIN_SERIES);
  const mostPlayed = [...rivals].sort((a, b) => b.games - a.games || Math.abs(a.wins - a.losses) - Math.abs(b.wins - b.losses)).slice(0, 5);
  const lopsided = [...series].sort((a, b) => (b.wins - b.losses) / b.games - (a.wins - a.losses) / a.games || b.margin - a.margin).slice(0, 5);
  const closest = [...series].sort((a, b) => Math.abs(a.wins - a.losses) - Math.abs(b.wins - b.losses) || Math.abs(a.margin) - Math.abs(b.margin)).slice(0, 5);
  const rivalList = (title: string, items: typeof rivals) => (
    <div className="rounded-lg border border-[var(--border)] p-4">
      <h4 className="mb-2 text-sm font-semibold text-[var(--foreground)]">{title}</h4>
      <ol className="space-y-1.5 text-xs">
        {items.map((r) => (
          <li key={`${r.a}-${r.b}`}>
            <button type="button" onClick={() => setSelected([r.a, r.b])} className="text-left hover:underline">
              <span className="font-semibold text-[var(--foreground)]">{nameOf(r.a)}</span>
              <span className="text-[var(--muted)]"> leads </span>
              <span className="text-[var(--foreground)]">{nameOf(r.b)}</span>
              <span className="text-[var(--muted)]"> {record(r.wins, r.losses, r.ties)} ({r.games} games, {r.margin >= 0 ? '+' : '−'}{Math.abs(r.margin).toFixed(1)} per game)</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );

  const pair = selected ? h2h[selected[0]]?.[selected[1]] : null;
  const standingsRows = sortRows(standings, standingsSort.state, (r, key) =>
    ({
      seasons: r.seasons,
      record: recordValue(r.wins, r.losses, r.ties),
      winPct: r.winPct,
      ppg: r.scoredGames ? r.pointsPerGame : null,
      playoffs: r.playoffs,
      finals: r.finals,
      titles: r.titles,
      toilet: r.toiletLosses,
      best: r.bestFinish,
    })[key]
  );

  return (
    <div className="space-y-6">
      <SectionCard
        title="Champions"
        subtitle="Every season's champion, runner-up and toilet bowl loser (top three before Sleeper, when the toilet bowl wasn't recorded)"
        gradientType="warning"
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-3">
          {data.seasons.map((s) => (
            <div key={s.season} className="rounded-lg border border-[var(--border)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-lg font-bold text-[var(--foreground)]">{s.season}</span>
                {!s.complete && <span className="rounded-full bg-[var(--neutral-bg)] px-2 py-0.5 text-xs text-[var(--neutral-text)]">In progress</span>}
                {s.legacy && <span className="rounded-full bg-[var(--neutral-bg)] px-2 py-0.5 text-xs text-[var(--neutral-text)]">Before Sleeper</span>}
              </div>
              {s.complete ? (
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">🏆 Champion</div>
                    {person(s.champion, s.season)}
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">🥈 Runner-up</div>
                    {person(s.runnerUp, s.season)}
                  </div>
                  {s.thirdPlace && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">🥉 Third place</div>
                      {person(s.thirdPlace, s.season)}
                    </div>
                  )}
                  {s.toiletLoser && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">💩 Lost the toilet bowl</div>
                      {person(s.toiletLoser, s.season)}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">Champion to be decided.</p>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="All-Time Standings" subtitle="Regular-season records plus postseason results, by manager" gradientType="primary">
        <SortStatus sort={standingsSort} />
        {/* Scrolls inside a window-height box so the header row stays in view */}
        <div className="max-h-[75vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-20 bg-[var(--surface-elevated)]">
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wider text-[var(--muted)]">
                <th className="px-4 py-3 font-medium">Manager</th>
                <SortableTh sort={standingsSort} col="seasons" className="px-3 py-3 text-center font-medium">Seasons</SortableTh>
                <SortableTh sort={standingsSort} col="record" className="px-3 py-3 text-center font-medium">Record</SortableTh>
                <SortableTh sort={standingsSort} col="winPct" className="px-3 py-3 text-center font-medium">Win %</SortableTh>
                <SortableTh sort={standingsSort} col="ppg" label="Points per game" className="px-3 py-3 text-center font-medium">Pts/game</SortableTh>
                <SortableTh sort={standingsSort} col="playoffs" label="Playoff appearances" className="px-3 py-3 text-center font-medium">Playoffs</SortableTh>
                <SortableTh sort={standingsSort} col="finals" className="px-3 py-3 text-center font-medium">Finals</SortableTh>
                <SortableTh sort={standingsSort} col="titles" className="px-3 py-3 text-center font-medium">Titles</SortableTh>
                <SortableTh sort={standingsSort} col="toilet" best="asc" className="px-3 py-3 text-center font-medium">Toilet bowl losses</SortableTh>
                <SortableTh sort={standingsSort} col="best" tip="Highest final place in any season (1st–6th from Sleeper brackets, 1st–3rd before)" tipAlign="right" best="asc" className="px-3 py-3 text-center font-medium">Best finish</SortableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {standingsRows.map((r) => (
                <tr key={r.userId} className={mineRow(r.userId === me.userId)}>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar m={managers.get(r.userId)} size={6} />
                      <span className="font-medium text-[var(--foreground)]">{nameOf(r.userId)}</span>
                      {managers.get(r.userId)?.firstName && managers.get(r.userId)!.firstName !== nameOf(r.userId) && (
                        <span className="text-xs text-[var(--muted)]">{managers.get(r.userId)!.firstName}</span>
                      )}
                      {!current.has(r.userId) && <span className="text-xs text-[var(--muted)]">· former</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center text-[var(--foreground)]">{r.seasons}</td>
                  <td className="px-3 py-2 text-center text-[var(--foreground)]">{record(r.wins, r.losses, r.ties)}</td>
                  <td className="px-3 py-2 text-center text-[var(--foreground)]">{(r.winPct * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-center text-[var(--foreground)]">{r.scoredGames ? r.pointsPerGame.toFixed(1) : '—'}</td>
                  <td className="px-3 py-2 text-center text-[var(--foreground)]">{r.playoffs}</td>
                  <td className="px-3 py-2 text-center text-[var(--foreground)]">{r.finals}</td>
                  <td className="px-3 py-2 text-center font-semibold text-[var(--foreground)]">{r.titles ? `🏆 ${r.titles}` : '0'}</td>
                  <td className="px-3 py-2 text-center font-semibold text-[var(--foreground)]">{r.toiletLosses ? `💩 ${r.toiletLosses}` : '0'}</td>
                  <td className="px-3 py-2 text-center text-[var(--foreground)]">{r.bestFinish ? ordinal(r.bestFinish) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-xs text-[var(--muted)]">
          Records are regular season only and go back to 2017; ties count as half a win. Points per game, playoff appearances
          and toilet bowl losses start in 2022 (earlier seasons only kept standings and the top three). Best finish is the
          final place (1st–6th from Sleeper brackets, 1st–3rd before).
        </p>
      </SectionCard>

      <SectionCard
        title="Head to Head"
        subtitle="Each row's all-time record against each column, regular season and playoffs (not placement or toilet bowl games). Tap a cell for every meeting."
        gradientType="secondary"
      >
        <div className="overflow-x-auto p-4 sm:p-6">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--surface-elevated)]" />
                {order.map((id) => (
                  <th key={id} className="px-1 pb-2 font-medium text-[var(--muted)]">
                    <div className="mx-auto w-14 truncate" title={nameOf(id)}>{nameOf(id)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map((row) => (
                <tr key={row}>
                  <th className="sticky left-0 z-10 bg-[var(--surface-elevated)] pr-2 text-left font-medium text-[var(--foreground)]">
                    <div className="w-24 truncate" title={nameOf(row)}>{nameOf(row)}</div>
                  </th>
                  {order.map((col) => {
                    if (row === col) return <td key={col} className="h-9 w-14 bg-[var(--neutral-bg)]" />;
                    const c = h2h[row]?.[col];
                    if (!c) return <td key={col} className="h-9 w-14 text-center text-[var(--muted)]">—</td>;
                    const n = c.wins + c.losses + c.ties;
                    const { backgroundColor, textColor } = getHeatmapColorByRatio((c.wins + c.ties / 2) / n);
                    const on = selected?.[0] === row && selected?.[1] === col;
                    return (
                      <td key={col} className="p-0.5">
                        <button
                          type="button"
                          onClick={() => setSelected([row, col])}
                          className={`heat-cell h-8 w-14 rounded text-center font-semibold ${on ? 'ring-2 ring-[var(--accent)]' : ''}`}
                          style={{ backgroundColor, color: textColor }}
                          title={`${nameOf(row)} vs ${nameOf(col)}: ${record(c.wins, c.losses, c.ties)}`}
                        >
                          {record(c.wins, c.losses, c.ties)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {selected && pair && (
            <div className="mt-5 rounded-lg border border-[var(--border)] p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold text-[var(--foreground)]">
                  {nameOf(selected[0])} vs {nameOf(selected[1])}: {record(pair.wins, pair.losses, pair.ties)}
                </h4>
                <span className="text-xs text-[var(--muted)]">
                  Points {pair.pointsFor.toFixed(1)} – {pair.pointsAgainst.toFixed(1)} · avg margin{' '}
                  {(pair.pointsFor - pair.pointsAgainst) / pair.games.length >= 0 ? '+' : '−'}
                  {Math.abs((pair.pointsFor - pair.pointsAgainst) / pair.games.length).toFixed(1)}
                </span>
              </div>
              <ul className="space-y-1 text-xs">
                {[...pair.games].reverse().map((g, i) => (
                  <li key={i}>{gameLine(g, selected[0])}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Rivalries" subtitle={`Series of ${MIN_SERIES}+ games for lopsided and closest`} gradientType="accent">
        <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-3">
          {rivalList('Most played', mostPlayed)}
          {rivalList('Most lopsided', lopsided)}
          {rivalList('Closest', closest)}
        </div>
      </SectionCard>

      <ErrorBoundary>
        <TradeHistory history={data} />
      </ErrorBoundary>

      <SectionCard
        title="Record Book"
        subtitle="Regular season and playoff games (not placement, consolation or toilet bowl games); season records count completed regular seasons"
        gradientType="success"
      >
        <div className="grid gap-4 p-4 sm:p-6 md:grid-cols-2 xl:grid-cols-3">
          {gameList('Highest scores', records.highestScores)}
          {gameList('Lowest scores', records.lowestScores)}
          {gameList('Biggest blowouts', records.biggestBlowouts)}
          {gameList('Closest games', records.closestGames)}
          {gameList('Highest combined scores', records.highestCombined)}
          {gameList('Most points in a loss', records.mostPointsInLoss)}
          {gameList('Fewest points in a win', records.fewestPointsInWin)}
          {seasonList('Best seasons', records.bestSeasons, 'record')}
          {seasonList('Worst seasons', records.worstSeasons, 'record')}
          {seasonList('Most points per game, season', records.mostPointsSeasons, 'points')}
          {seasonList('Fewest points per game, season', records.fewestPointsSeasons, 'points')}
        </div>
      </SectionCard>
    </div>
  );
}
