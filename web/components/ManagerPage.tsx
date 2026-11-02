'use client';

import { useMemo, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import TeamAvatar from '@/components/ui/TeamAvatar';
import ShareButton from '@/components/ui/ShareButton';
import { loadSeason } from '@/components/TradeHistory';
import { useSharedFetch } from '@/hooks/useSharedFetch';
import { getHeatmapColorByRatio, RESULT_DOT_COLORS } from '@/lib/constants';
import { signed } from '@/lib/format';
import type { HistoryData, HistoryGame } from '@/lib/analyze/history';
import { managerProfile, type ProfileGame, type ProfileSeason } from '@/lib/analyze/managerProfile';
import { netHindsight, tradeLeaders, type SeasonTrade } from '@/lib/analyze/tradeLeaders';
import type { TradeHistoryResponse } from '@/lib/analyze/trade';

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const record = (w: number, l: number, t = 0) => `${w}-${l}${t ? `-${t}` : ''}`;
const KIND: Record<HistoryGame['kind'], string> = { regular: '', playoff: ' · Playoffs', placement: ' · Placement', consolation: ' · Consolation', toilet: ' · Toilet bowl' };

interface Props {
  data: HistoryData;
  userId: string;
  /** Count playoff and toilet bowl games in records (the History tab's switch) */
  postseason: boolean;
  onBack: () => void;
  /** Open another manager's page */
  onManager: (userId: string) => void;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</div>
      <div className="text-lg font-semibold text-[var(--foreground)]">{value}</div>
      {sub && <div className="truncate text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

/** A season's finish in words: champion, runner-up, a placement, playoffs, or the toilet bowl */
function finish(s: ProfileSeason): { text: string; tone: 'win' | 'loss' | null } {
  if (s.champion) return { text: '🏆 Champion', tone: 'win' };
  if (s.runnerUp) return { text: 'Runner-up', tone: 'win' };
  if (s.toiletLoser) return { text: '💩 Lost the toilet bowl', tone: 'loss' };
  if (!s.complete) return { text: 'In progress', tone: null };
  if (s.third) return { text: '3rd place', tone: null };
  // Before Sleeper only the top three were recorded: no playoff field, no other finishes
  if (s.legacy) return { text: '', tone: null };
  if (s.placement) return { text: `${ordinal(s.placement)} place`, tone: null };
  return { text: s.playoffs ? 'Playoffs' : 'Missed playoffs', tone: null };
}

/**
 * One manager's page in the History tab (lib/analyze/managerProfile.ts): career totals and their
 * league ranks, every season, the record against each manager, best and worst games, and trades.
 */
export default function ManagerPage({ data, userId, postseason, onBack, onManager }: Props) {
  const managers = useMemo(() => new Map(data.managers.map((m) => [m.userId, m])), [data]);
  const nameOf = (id: string) => managers.get(id)?.name ?? 'Unknown';
  const profile = useMemo(() => managerProfile(data, userId, { postseason }), [data, userId, postseason]);
  // The opponent whose meetings are open
  const [open, setOpen] = useState<string | null>(null);

  // Every Sleeper season's trades (shared with the Trades section)
  const sleeperSeasons = useMemo(() => data.seasons.filter((s) => !s.legacy), [data]);
  const { data: tradeSeasons } = useSharedFetch<TradeHistoryResponse[]>('trades:all', () => Promise.all(sleeperSeasons.map((s) => loadSeason(s.season, s.complete))));
  const trades = useMemo(() => {
    if (!tradeSeasons) return null;
    const byRoster = new Map(sleeperSeasons.flatMap((s) => s.teams.map((t) => [`${s.season}:${t.rosterId}`, t.userId] as const)));
    const userOf = (season: string, rosterId: number) => byRoster.get(`${season}:${rosterId}`) ?? null;
    const all: SeasonTrade[] = tradeSeasons.flatMap((s) => s.trades.map((trade) => ({ season: s.season, trade })));
    const leader = tradeLeaders(all, userOf).leaders.find((l) => l.userId === userId) ?? null;
    const playerName = (season: string, id: string) => tradeSeasons.find((s) => s.season === season)?.players[id]?.name ?? id;
    const mine = all.flatMap(({ season, trade }) =>
      trade.sides
        .filter((side) => userOf(season, side.rosterId) === userId)
        .map((side) => ({
          season,
          week: trade.week,
          net: netHindsight(trade, side),
          got: [...side.receives.map((p) => playerName(season, p)), ...side.picks],
          gave: side.sends.map((p) => playerName(season, p)),
          with: trade.sides.filter((o) => o !== side).map((o) => userOf(season, o.rosterId)).filter((x): x is string => !!x),
        }))
    );
    const best = mine.length ? mine.reduce((b, t) => (t.net > b.net ? t : b)) : null;
    const worst = mine.length > 1 ? mine.reduce((w, t) => (t.net < w.net ? t : w)) : null;
    return { leader, count: mine.length, best, worst };
  }, [tradeSeasons, sleeperSeasons, userId]);

  const back = (
    <button type="button" onClick={onBack} className="text-sm font-medium text-[var(--accent)] hover:underline">
      ← League history
    </button>
  );
  if (!profile) {
    return (
      <div className="space-y-4">
        {back}
        <p className="text-[var(--muted)]">No history for this manager.</p>
      </div>
    );
  }

  const m = managers.get(userId);
  const { totals, ranks, seasons } = profile;
  const titles = seasons.filter((s) => s.champion).map((s) => s.season);
  const toilets = seasons.filter((s) => s.toiletLoser).map((s) => s.season);
  const sleeperCount = seasons.filter((s) => s.pointsPerGame !== null).length;
  // Team names, newest first, each once
  const names = [...new Set(seasons.map((s) => s.teamName.trim()))];
  const latestAvatar = seasons.find((s) => s.avatarUrl)?.avatarUrl ?? m?.avatarUrl ?? null;
  const game = (g: ProfileGame | null) =>
    g && (
      <>
        <span className="font-semibold text-[var(--foreground)]">{g.pf.toFixed(2)}</span>
        <span className="text-[var(--muted)]"> – {g.pa.toFixed(2)} vs {nameOf(g.opponent)}, {g.game.season} wk {g.game.week}{KIND[g.game.kind]}</span>
      </>
    );
  const meetings = (opp: string) =>
    data.games
      .filter((g) => (g.a === userId && g.b === opp) || (g.b === userId && g.a === opp))
      .filter((g) => g.kind === 'regular' || (postseason && (g.kind === 'playoff' || g.kind === 'toilet')))
      .map((g) => (g.a === userId ? { g, pf: g.pa, pa: g.pb } : { g, pf: g.pb, pa: g.pa }))
      .sort((x, y) => Number(y.g.season) - Number(x.g.season) || y.g.week - x.g.week);

  return (
    <div className="space-y-6">
      {back}

      <SectionCard title={nameOf(userId)} subtitle={names.length > 1 ? `As ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}` : names[0]} gradientType="primary">
        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <TeamAvatar url={latestAvatar} name={nameOf(userId)} size="h-14 w-14" />
            <div className="min-w-0 flex-1 text-sm text-[var(--muted)]">
              {totals.seasons} season{totals.seasons === 1 ? '' : 's'} · {seasons[seasons.length - 1]?.season}–{seasons[0]?.season}
            </div>
            <ShareButton icon path={`/?tab=history&manager=${userId}`} title={`${nameOf(userId)} in the league's history`} className="shrink-0 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Record" value={record(totals.wins, totals.losses, totals.ties)} sub={`${(totals.winPct * 100).toFixed(1)}% · ${ordinal(ranks.winPct)} of ${ranks.of}${seasons[0] && !seasons[0].complete ? ` · incl. ${seasons[0].season}` : ''}`} />
            <Tile label="Points per game" value={totals.scoredGames ? totals.pointsPerGame.toFixed(1) : '—'} sub={totals.scoredGames ? `${ordinal(ranks.pointsPerGame)} · since Sleeper` : 'Sleeper seasons only'} />
            <Tile label="Titles" value={titles.length ? `🏆 ${titles.length}` : '0'} sub={titles.length ? titles.join(', ') : undefined} />
            <Tile label="Finals" value={String(totals.finals)} sub={totals.bestFinish ? `Best finish ${ordinal(totals.bestFinish)}` : undefined} />
            <Tile label="Playoffs" value={`${totals.playoffs}`} sub={sleeperCount ? `of ${sleeperCount} Sleeper season${sleeperCount === 1 ? '' : 's'}` : undefined} />
            <Tile label="Playoff games" value={record(profile.playoffRecord.wins, profile.playoffRecord.losses)} />
            <Tile label="Toilet bowl losses" value={toilets.length ? `💩 ${toilets.length}` : '0'} sub={toilets.length ? toilets.join(', ') : undefined} />
            <Tile label="Trades" value={trades ? String(trades.count) : '…'} sub={trades?.leader?.topPartner ? `Most with ${nameOf(trades.leader.topPartner.userId)} (${trades.leader.topPartner.trades})` : undefined} />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Season by Season" subtitle="Regular-season record and points per game, then where the season ended" gradientType="info">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border)] text-sm">
            <thead className="bg-[var(--surface)] text-xs uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Season</th>
                <th className="px-4 py-2 text-left font-medium">Team and finish</th>
                <th className="px-4 py-2 text-center font-medium">Record</th>
                <th className="px-4 py-2 text-right font-medium">PPG</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {seasons.map((s) => {
                const f = finish(s);
                return (
                  <tr key={s.season}>
                    <td className="px-4 py-2 font-semibold text-[var(--foreground)]">{s.season}</td>
                    <td className="max-w-[11rem] px-4 py-2 sm:max-w-none">
                      <div className="truncate text-[var(--foreground)]" title={s.teamName}>{s.teamName}</div>
                      {f.text && <div className="truncate text-xs" style={{ color: f.tone === 'win' ? RESULT_DOT_COLORS.W : f.tone === 'loss' ? RESULT_DOT_COLORS.L : 'var(--muted)' }}>{f.text}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-center tabular-nums text-[var(--foreground)]">
                      {record(s.wins, s.losses, s.ties)}
                      {s.regularRank && <span className="block text-xs text-[var(--muted)]">{ordinal(s.regularRank)} of {s.teams > 1 ? s.teams : '—'}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[var(--foreground)]">{s.pointsPerGame !== null ? s.pointsPerGame.toFixed(1) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Head to Head"
        subtitle={`Against every manager, ${postseason ? 'regular season, playoffs and toilet bowl' : 'regular season only'}. Tap a row for every meeting.`}
        gradientType="info"
      >
        <div className="space-y-4 p-4 sm:p-6">
          {(profile.nemesis || profile.favorite) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {profile.favorite && (
                <Tile label="Favorite opponent" value={nameOf(profile.favorite.userId)} sub={`${record(profile.favorite.wins, profile.favorite.losses, profile.favorite.ties)}, ${signed(profile.favorite.margin)} a game`} />
              )}
              {profile.nemesis && (
                <Tile label="Nemesis" value={nameOf(profile.nemesis.userId)} sub={`${record(profile.nemesis.wins, profile.nemesis.losses, profile.nemesis.ties)}, ${signed(profile.nemesis.margin)} a game`} />
              )}
            </div>
          )}
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {profile.opponents.map((o) => {
              const { backgroundColor, textColor } = getHeatmapColorByRatio(o.winPct);
              return (
                <li key={o.userId}>
                  <button
                    type="button"
                    onClick={() => setOpen(open === o.userId ? null : o.userId)}
                    aria-expanded={open === o.userId}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--hover)]"
                  >
                    <TeamAvatar url={managers.get(o.userId)?.avatarUrl} name={nameOf(o.userId)} size="h-7 w-7" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">{nameOf(o.userId)}</span>
                    <span className="heat-cell rounded px-2 py-0.5 text-xs font-semibold tabular-nums" style={{ backgroundColor, color: textColor }}>
                      {record(o.wins, o.losses, o.ties)}
                    </span>
                    <span className="w-16 text-right text-xs tabular-nums text-[var(--muted)]">{signed(o.margin)}/g</span>
                  </button>
                  {open === o.userId && (
                    <div className="space-y-1 px-3 pb-3 text-xs">
                      <button type="button" onClick={() => onManager(o.userId)} className="mb-1 font-medium text-[var(--accent)] hover:underline">
                        {nameOf(o.userId)}&apos;s page →
                      </button>
                      <ol className="space-y-1">
                        {meetings(o.userId).map(({ g, pf, pa }, i) => (
                          <li key={i}>
                            <span className="text-[var(--muted)]">{g.season} wk {g.week}{KIND[g.kind]}: </span>
                            <span className={pf > pa ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--foreground)]'}>{pf.toFixed(2)}</span>
                            <span className="text-[var(--muted)]"> – </span>
                            <span className={pa > pf ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--foreground)]'}>{pa.toFixed(2)}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </SectionCard>

      <SectionCard title="Highlights" subtitle="Regular season and playoff games (not placement, consolation or toilet bowl)" gradientType="info">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2 sm:p-6">
          {[
            ['Best game', profile.highest],
            ['Worst game', profile.lowest],
            ['Biggest win', profile.biggestWin],
            ['Toughest loss', profile.worstLoss],
          ].map(([label, g]) =>
            g ? (
              <div key={label as string}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{label as string}</dt>
                <dd>{game(g as ProfileGame)}</dd>
              </div>
            ) : null
          )}
          {trades?.best && (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Best trade (net points in hindsight)</dt>
              <dd>
                <span className="font-semibold text-[var(--foreground)]">{signed(trades.best.net)}</span>
                <span className="text-[var(--muted)]"> · {trades.best.season} wk {trades.best.week} with {trades.best.with.map(nameOf).join(', ')}: got {trades.best.got.join(', ') || 'nothing'} for {trades.best.gave.join(', ') || 'nothing'}</span>
              </dd>
            </div>
          )}
          {trades?.worst && (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">Worst trade</dt>
              <dd>
                <span className="font-semibold text-[var(--foreground)]">{signed(trades.worst.net)}</span>
                <span className="text-[var(--muted)]"> · {trades.worst.season} wk {trades.worst.week} with {trades.worst.with.map(nameOf).join(', ')}: got {trades.worst.got.join(', ') || 'nothing'} for {trades.worst.gave.join(', ') || 'nothing'}</span>
              </dd>
            </div>
          )}
        </dl>
      </SectionCard>
    </div>
  );
}
