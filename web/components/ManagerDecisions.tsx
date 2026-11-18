'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import Term from '@/components/ui/Term';
import { fetchFirst, useSharedFetch } from '@/hooks/useSharedFetch';
import { signed } from '@/lib/format';
import type { HistoryData } from '@/lib/analyze/history';
import type { SeasonInsights } from '@/lib/analyze/insights';
import { against, middleHalf, summarize, teamSeasonDecisions, type DecisionSummary, type TeamSeasonDecisions } from '@/lib/analyze/decisions';

/** Asks the app to open a manager's page at this section (components/App.tsx listens; detail: their user ID) */
export const OPEN_DECISIONS_EVENT = 'tangy:open-decisions';
export const decisionsLink = (userId: string) => `?tab=history&manager=${userId}&section=decisions`;

export interface ManagerTrades {
  count: number;
  /** Net lineup points over every trade (what came in, minus what went out, in each lineup afterwards) */
  net: number;
  seasons: number;
  best: { season: string; week: number; net: number; got: string[] } | null;
}

const fmt = (v: number, digits = 0) => (Math.abs(v) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : v.toFixed(digits));

/** The league's typical season (its middle half, shaded) and this manager's value (the dot); `better` says which way is good */
function Strip({ value, band, all, better, label }: { value: number; band: [number, number] | null; all: number[]; better: 'low' | 'high'; label: string }) {
  if (!band) return null;
  const lo = Math.min(...all, value);
  const hi = Math.max(...all, value);
  const x = (v: number) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50);
  return (
    <div className="mt-2">
      <div className="relative h-3" role="img" aria-label={`${label}: the league's typical season is ${fmt(band[0], 1)} to ${fmt(band[1], 1)}; this is ${fmt(value, 1)}`}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
        <div className="absolute inset-y-0 rounded-sm bg-[var(--accent)] opacity-25" style={{ left: `${x(band[0])}%`, width: `${Math.max(x(band[1]) - x(band[0]), 1)}%` }} />
        <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--foreground)]" style={{ left: `${x(value)}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-[var(--muted)]">
        <span>{better === 'low' ? 'Better' : 'Fewer'}</span>
        <span>Shaded: a typical season here</span>
        <span>{better === 'low' ? 'Worse' : 'More'}</span>
      </div>
    </div>
  );
}

function Badge({ luck }: { luck: boolean }) {
  return (
    <Term
      align="left"
      tip={
        luck
          ? 'In thousands of other leagues, how this turns out for a manager one season says almost nothing about the next: it swings with luck.'
          : "In thousands of other leagues, managers who do well at this one season tend to again the next: it's a habit, not luck."
      }
    >
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${luck ? 'bg-[var(--neutral-bg)] text-[var(--neutral-text)]' : 'bg-[var(--info-bg)] text-[var(--info-text)]'}`}>
        {luck ? 'Swings with luck' : 'Carries over'}
      </span>
    </Term>
  );
}

function Panel({ title, luck, big, sentence, strip, rows, details }: { title: string; luck: boolean; big: string; sentence: ReactNode; strip?: ReactNode; rows: Array<[string, ReactNode]>; details?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--foreground)]">{title}</h4>
        <Badge luck={luck} />
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-[var(--foreground)]">{big}</div>
      <p className="text-xs text-[var(--muted)]">{sentence}</p>
      {strip}
      <dl className="mt-3 space-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-[var(--muted)]">{k}</dt>
            <dd className="text-right font-medium tabular-nums text-[var(--foreground)]">{v}</dd>
          </div>
        ))}
      </dl>
      {details && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer list-none font-semibold uppercase tracking-wider text-[var(--muted)] hover:text-[var(--foreground)] [&::-webkit-details-marker]:hidden">› Details</summary>
          <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">{details}</div>
        </details>
      )}
    </div>
  );
}

/**
 * A manager's decisions (lib/analyze/decisions.ts): start/sit and waiver habits judged before
 * kickoff against their own roster, and what their trades did, each against a typical season in
 * this league. Career or one season. `focus` changes when a link asks for this section.
 */
export default function ManagerDecisions({ data, userId, trades, focus = 0 }: { data: HistoryData; userId: string; trades: ManagerTrades | null; focus?: number }) {
  const sleeperSeasons = useMemo(() => data.seasons.filter((s) => !s.legacy), [data]);
  const { data: insights } = useSharedFetch<SeasonInsights[]>('insights:all', () =>
    Promise.all(
      sleeperSeasons.map((s) =>
        fetchFirst<SeasonInsights>([...(s.complete ? [`/data/season-insights/${s.season}.json`] : []), `/api/season-insights/${s.season}`], 'the season’s lineups')
      )
    )
  );
  const [scope, setScope] = useState<string>('career');
  const ref = useRef<HTMLDivElement | null>(null);

  // A link to this section: bring it into view (again as the page above it settles)
  useEffect(() => {
    if (!focus || !insights) return;
    const ids = [50, 600, 1500].map((ms) => window.setTimeout(() => ref.current?.scrollIntoView({ block: 'start' }), ms));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [focus, insights]);

  const model = useMemo(() => {
    if (!insights) return null;
    const rosterOf = new Map(sleeperSeasons.flatMap((s) => s.teams.map((t) => [`${s.season}:${t.rosterId}`, t.userId] as const)));
    const all: Array<{ userId: string; d: TeamSeasonDecisions; insights: SeasonInsights }> = [];
    for (const ins of insights) {
      for (const d of teamSeasonDecisions(ins)) {
        const owner = rosterOf.get(`${ins.season}:${d.rosterId}`);
        if (owner && d.weeks) all.push({ userId: owner, d, insights: ins });
      }
    }
    // The league's typical full season, from finished ones
    const finished = all.filter((r) => sleeperSeasons.find((s) => s.season === r.d.season)?.complete);
    const per = (r: (typeof all)[number]) => summarize([r.d]);
    const values = {
      givenUp: finished.map((r) => per(r).givenUpPerSeason),
      proactive: finished.map((r) => per(r).proactivePerSeason),
      share: finished.map((r) => per(r).projectionLineupWeeks / Math.max(per(r).weeks, 1)),
    };
    return { mine: all.filter((r) => r.userId === userId), values, bands: { givenUp: middleHalf(values.givenUp), proactive: middleHalf(values.proactive) } };
  }, [insights, sleeperSeasons, userId]);

  if (!model) {
    return (
      <SectionCard title="Decisions" subtitle="What this manager controlled, against what their own roster offered" gradientType="success">
        <p className="p-4 text-sm text-[var(--muted)] sm:p-6">Loading their lineups…</p>
      </SectionCard>
    );
  }
  if (!model.mine.length) return null;

  const seasonsPlayed = model.mine.map((r) => r.d.season).sort((a, b) => Number(b) - Number(a));
  const shown = scope === 'career' ? model.mine : model.mine.filter((r) => r.d.season === scope);
  const s: DecisionSummary = summarize(shown.map((r) => r.d));
  const inProgress = shown.some((r) => !sleeperSeasons.find((x) => x.season === r.d.season)?.complete);
  const name = (season: string, id: string) => shown.find((r) => r.d.season === season)?.insights.players[id]?.name ?? id;
  const when = (season: string, week: number) => (scope === 'career' ? `${season} wk ${week}` : `Week ${week}`);
  // A season in progress is scaled to a full one, so it compares; say so
  const perSeason = scope === 'career' ? ' a season' : inProgress ? ' at a full season’s pace' : '';

  // The one-line read: where each habit sits against a typical season here (no numbers)
  const sit = against(s.givenUpPerSeason, model.bands.givenUp);
  const pick = against(s.proactivePerSeason, model.bands.proactive);
  const noShowRate = s.noShows / Math.max(s.seasons, 1);
  const parts = [
    sit === 'below' ? 'gives away fewer start/sit points than most' : sit === 'above' ? 'gives away more start/sit points than most' : 'gives away about as many start/sit points as most',
    noShowRate < 0.5 ? 'rarely starts players who can’t play' : noShowRate >= 2 ? 'starts players who can’t play more than most' : null,
    pick === 'above' ? 'picks up players before they need them more than most' : pick === 'below' ? 'rarely picks up players before they need them' : null,
  ].filter(Boolean) as string[];
  const summary = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];

  const overrides = shown.flatMap((r) => r.d.overrides.map((o) => ({ ...o, season: r.d.season }))).sort((a, b) => Number(b.season) - Number(a.season) || b.week - a.week);
  const noShows = shown.flatMap((r) => r.d.noShows.map((n) => ({ ...n, season: r.d.season })));
  const proactive = shown
    .flatMap((r) => r.d.pickups.filter((p) => p.proactive).map((p) => ({ ...p, season: r.d.season })))
    .sort((a, b) => b.points - a.points);

  return (
    <div ref={ref} className="scroll-mt-20">
      <SectionCard title="Decisions" subtitle="What this manager controlled, against what their own roster offered" gradientType="success">
        <div className="space-y-4 p-4 sm:p-6">
          <div className="flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Seasons">
            {['career', ...seasonsPlayed].map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setScope(id)}
                aria-pressed={scope === id}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  scope === id ? 'bg-[var(--info-bg)] text-[var(--info-text)]' : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                {id === 'career' ? 'Career' : id}
              </button>
            ))}
          </div>
          <p className="text-sm text-[var(--foreground)]">
            {summary.charAt(0).toUpperCase() + summary.slice(1)}.
            {inProgress ? <span className="text-[var(--muted)]"> {scope === 'career' ? `(Includes ${seasonsPlayed[0]} so far.)` : '(So far, at a full season’s pace.)'}</span> : null}
          </p>

          <div className="grid gap-3 lg:grid-cols-3">
            <Panel
              title="Start/sit"
              luck={false}
              big={`${fmt(s.givenUpPerSeason)} pts`}
              sentence={
                <>
                  Projected points given up{perSeason} against the best lineup its projections recommended from the same roster (about{' '}
                  {s.givenUpWinsPerSeason.toFixed(2)} wins).
                </>
              }
              strip={<Strip value={s.givenUpPerSeason} band={model.bands.givenUp} all={model.values.givenUp} better="low" label="Projected start/sit points given up a season" />}
              rows={[
                ['Started the projections’ lineup', `${s.projectionLineupWeeks} of ${s.weeks} weeks`],
                ['Started someone who couldn’t play', `${s.noShows} time${s.noShows === 1 ? '' : 's'}`],
                [
                  'Overrides',
                  <>
                    {s.overrides} · {signed(s.overrideNet, 0)} pts actual
                  </>,
                ],
                ['Games overrides won / lost', `${s.gamesWon} / ${s.gamesLost}`],
              ]}
              details={
                <>
                  <p className="text-[var(--muted)]">
                    An override is a lineup projected at least 1 point below the best one. How they turned out swings with luck; how
                    often they happen doesn&apos;t.
                  </p>
                  {overrides.map((o) => (
                    <div key={`${o.season}-${o.week}`} className="border-t border-[var(--border)] pt-1">
                      <span className="font-medium text-[var(--foreground)]">{when(o.season, o.week)}</span>{' '}
                      <span className="text-[var(--muted)]">
                        started {o.started.map((id) => name(o.season, id)).join(', ') || '—'} over {o.benched.map((id) => name(o.season, id)).join(', ') || '—'}: projected{' '}
                        {signed(-o.projectedCost, 1)}, actual {signed(o.actual, 1)}
                        {o.flipped === 'won' ? ' · won the game' : o.flipped === 'lost' ? ' · lost the game' : ''}
                      </span>
                    </div>
                  ))}
                  {noShows.map((n) => (
                    <div key={`${n.season}-${n.week}-${n.playerId}`} className="border-t border-[var(--border)] pt-1">
                      <span className="font-medium text-[var(--foreground)]">{when(n.season, n.week)}</span>{' '}
                      <span className="text-[var(--muted)]">started {name(n.season, n.playerId)}, projected for 0 (on bye or out)</span>
                    </div>
                  ))}
                  {!overrides.length && !noShows.length && <p className="text-[var(--muted)]">Started the projections&apos; lineup every week.</p>}
                </>
              }
            />
            <Panel
              title="Waivers"
              luck={false}
              big={`${fmt(s.proactivePerSeason, 1)}`}
              sentence={<>Proactive pickups{perSeason}: players added while the lineup was already full, rather than to fill a hole.</>}
              strip={<Strip value={s.proactivePerSeason} band={model.bands.proactive} all={model.values.proactive} better="high" label="Proactive pickups a season" />}
              rows={[
                ['Pickups to fill a hole', `${s.fills}`],
                ['Lineup points from pickups', fmt(s.pickupPoints)],
                ...(proactive[0] ? ([['Best proactive pickup', `${name(proactive[0].season, proactive[0].playerId)} (${fmt(proactive[0].points)} pts)`]] as Array<[string, ReactNode]>) : []),
              ]}
              details={
                proactive.length ? (
                  proactive.slice(0, 15).map((p) => (
                    <div key={`${p.season}-${p.week}-${p.playerId}`} className="flex justify-between gap-2 border-t border-[var(--border)] pt-1">
                      <span className="text-[var(--foreground)]">
                        {name(p.season, p.playerId)} <span className="text-[var(--muted)]">· {when(p.season, p.week)}</span>
                      </span>
                      <span className="tabular-nums text-[var(--muted)]">{fmt(p.points)} pts</span>
                    </div>
                  ))
                ) : (
                  <p className="text-[var(--muted)]">No proactive pickups.</p>
                )
              }
            />
            <Panel
              title="Trades"
              luck
              big={trades ? `${signed(trades.net, 0)} pts` : '…'}
              sentence="Net lineup points over every trade: what came in, minus what went out, in each team's lineup afterwards. Career only."
              rows={
                trades
                  ? [
                      ['Trades', `${trades.count}`],
                      ...(trades.best ? ([['Best', `${signed(trades.best.net, 0)} pts (${trades.best.season} wk ${trades.best.week})`]] as Array<[string, ReactNode]>) : []),
                    ]
                  : []
              }
            />
          </div>
          <p className="text-xs text-[var(--muted)]">
            Every week is judged before kickoff, by Sleeper&apos;s projections, against the best lineup from this manager&apos;s own roster, then by what
            actually happened. Which habits carry over from season to season comes from thousands of other Sleeper leagues where every
            team stayed active. Shaded bands are the middle half of this league&apos;s finished seasons since 2022.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
