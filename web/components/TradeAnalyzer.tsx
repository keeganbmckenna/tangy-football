'use client';

import { marketFair } from '@/lib/analyze/tradeFinder';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useModelOdds, useOddsSimulator } from '@/hooks/useOddsSimulator';
import SectionCard from '@/components/ui/SectionCard';
import HowItWorks from '@/components/ui/HowItWorks';
import PlayerList from '@/components/ui/PlayerList';
import StickyResult from '@/components/ui/StickyResult';
import MoveImpact, { type ImpactSide } from '@/components/MoveImpact';
import { formatOdds, type OddsResult } from '@/lib/analyze/playoffOdds';
import {
  meansAfterTrade,
  rosterAfterTrade,
  lockedMoves,
  unchanged,
  withPickups,
  type RosterChange,
  type TradeDataResponse,
  type TradePlayerInfo,
} from '@/lib/analyze/trade';
import { waiverComparison, type WaiverComparison } from '@/lib/analyze/waiverFinder';
import type { TeamStats } from '@/lib/types';
import { signed } from '@/lib/format';

export interface TradePreset {
  teamA: number;
  teamB: number;
  sendA: string[];
  sendB: string[];
}

interface TradeAnalyzerProps {
  data: TradeDataResponse;
  teamStats: TeamStats[];
  /** A trade to start with (e.g. from the trade finder) */
  initial?: TradePreset | null;
}

const COLOR = { a: 'var(--trade-a)', b: 'var(--trade-b)' } as const;

/** A setting that's on or off, as a switch */
export function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (on: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-start gap-3 text-left">
      <span
        className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: on ? 'var(--accent)' : 'var(--chart-axis)' }}
        aria-hidden
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </span>
      <span>
        <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
        {hint && <span className="block text-xs text-[var(--muted)]">{hint}</span>}
      </span>
    </button>
  );
}

export default function TradeAnalyzer({ data, teamStats, initial = null }: TradeAnalyzerProps) {
  // A fresh analyzer starts with your team on the left, if you've picked one in the header
  const myTeam = useMyTeam();
  const [teamA, setTeamA] = useState<number | null>(initial?.teamA ?? myTeam.rosterId);
  const [teamB, setTeamB] = useState<number | null>(initial?.teamB ?? null);
  const [sendA, setSendA] = useState<string[]>(initial?.sendA ?? []);
  const [sendB, setSendB] = useState<string[]>(initial?.sendB ?? []);
  const [compare, setCompare] = useState(false);
  const simulate = useOddsSimulator(data);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  // Managers' names: they're how people know each other in the league
  const name = (id: number | null) => teamStats.find((t) => t.rosterId === id)?.username.trim() ?? (id === null ? '' : `Team ${id}`);
  const { inputs } = data;
  const rosterPlayers = (id: number | null) =>
    id === null ? [] : (inputs.rosters[id] ?? []).map((p) => data.players[p]).filter((p): p is TradePlayerInfo => !!p);
  // The week being played, once it has kicked off
  const live = data.model.live;

  const trade = useMemo(() => {
    if (teamA === null || teamB === null || sendA.length + sendB.length === 0) return null;
    const a = rosterAfterTrade(inputs, { rosterId: teamA, sends: sendA, receives: sendB });
    const b = rosterAfterTrade(inputs, { rosterId: teamB, sends: sendB, receives: sendA }, a.added);
    const { model } = meansAfterTrade(data.model, inputs, [a, b]);
    return { key: `${data.generatedAt}|${teamA}:${[...sendA].sort().join(',')}|${teamB}:${[...sendB].sort().join(',')}`, changes: { a, b }, model };
  }, [data, inputs, teamA, teamB, sendA, sendB]);

  // Each team's best pickups without the trade and after it: worked out a moment after the trade changes
  const [picks, setPicks] = useState<{ key: string; result: WaiverComparison } | null>(null);
  useEffect(() => {
    if (!compare || !trade) return;
    const id = window.setTimeout(() => setPicks({ key: trade.key, result: waiverComparison(data, [trade.changes.a, trade.changes.b], trade.model) }), 30);
    return () => window.clearTimeout(id);
  }, [compare, trade, data]);
  const comparison = compare && trade && picks?.key === trade.key ? picks.result : null;

  // With waivers counted: before is each team with its best pickups, after is the trade plus the best pickups after it
  const worlds = useMemo(() => {
    if (!trade || !comparison) return null;
    const { a, b } = trade.changes;
    const without = [a, b].map((c) => withPickups(inputs, unchanged(inputs, c.rosterId), comparison.without[c.rosterId] ?? []));
    const withTrade = [a, b].map((c) => withPickups(inputs, c, comparison.with[c.rosterId] ?? []));
    return {
      without,
      withTrade,
      before: meansAfterTrade(data.model, inputs, without).model,
      after: meansAfterTrade(data.model, inputs, withTrade).model,
    };
  }, [trade, comparison, data, inputs]);

  const baseOdds = useModelOdds(simulate, data.generatedAt, data.model);
  const tradeOdds = useModelOdds(simulate, trade?.key ?? null, trade?.model ?? null);
  const pickupOdds = useModelOdds(simulate, worlds ? `${trade!.key}|without` : null, worlds?.before ?? null);
  const tradePickupOdds = useModelOdds(simulate, worlds ? `${trade!.key}|with` : null, worlds?.after ?? null);

  const toggle = (setter: (f: (s: string[]) => string[]) => void) => (id: string) => setter((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const pickTeam = (side: 'a' | 'b') => (id: number | null) => {
    if (side === 'a') {
      setTeamA(id);
      setSendA([]);
    } else {
      setTeamB(id);
      setSendB([]);
    }
  };

  const nameA = name(teamA);
  const nameB = name(teamB);
  const playerName = (id: string) => data.players[id]?.name ?? id;
  const list = (ids: string[]) => {
    const names = ids.map(playerName);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  };
  /** A sentence ending in a list, without a doubled period after "Jr." */
  const end = (text: string) => (text.endsWith('.') ? text : `${text}.`);
  const marketTotal = (ids: string[]) => {
    const valued = ids.map((p) => data.players[p]?.value).filter((v): v is number => v !== null && v !== undefined);
    return { total: valued.reduce((s, v) => s + v, 0), valued: valued.length, count: ids.length };
  };

  const teamSelect = (side: 'a' | 'b', rosterId: number | null, other: number | null) => (
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: COLOR[side] }} aria-hidden />
      <label className="sr-only" htmlFor={`trade-team-${side}`}>
        {side === 'a' ? 'First manager' : 'Second manager'}
      </label>
      <select
        id={`trade-team-${side}`}
        value={rosterId ?? ''}
        onChange={(e) => pickTeam(side)(e.target.value ? Number(e.target.value) : null)}
        className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--foreground)]"
      >
        <option value="">Choose a manager</option>
        {teamStats
          .filter((t) => t.rosterId !== other)
          .sort((x, y) => x.username.localeCompare(y.username, undefined, { sensitivity: 'base' }))
          .map((t) => (
            <option key={t.rosterId} value={t.rosterId}>
              {t.username}
            </option>
          ))}
      </select>
    </div>
  );

  const sides: ImpactSide[] = trade
    ? (['a', 'b'] as const).map((side, i) => {
        const id = side === 'a' ? teamA! : teamB!;
        const gives = side === 'a' ? sendA : sendB;
        const gets = side === 'a' ? sendB : sendA;
        const give = marketTotal(gives);
        const get = marketTotal(gets);
        const change = worlds
          ? { ...worlds.withTrade[i], before: worlds.without[i].after }
          : trade.changes[side];
        return {
          rosterId: id,
          name: side === 'a' ? nameA : nameB,
          color: COLOR[side],
          change,
          sent: gives,
          received: gets,
          extra: data.marketValues ? (
            <p className="mt-2 text-[var(--foreground)]">
              Market value: gives {give.total.toLocaleString()}, gets {get.total.toLocaleString()}
              {give.valued < give.count || get.valued < get.count ? ' (kickers and defenses not valued)' : ''}
              {marketFair(gives.map((p) => data.players[p]?.value ?? 0), gets.map((p) => data.players[p]?.value ?? 0)) === false && (
                <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-[var(--warning-bg)] px-2 py-0.5 text-xs font-medium text-[var(--warning-text)]">
                  Overpays by market value
                </span>
              )}
            </p>
          ) : undefined,
        };
      })
    : [];

  return (
    <SectionCard
      title="Trade Analyzer"
      subtitle={`Pick two managers and the players moving. Trades are allowed through week ${data.tradeDeadline || data.regularSeasonEnd}.`}
      gradientType="primary"
    >
      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          {(['a', 'b'] as const).map((side) => {
            const id = side === 'a' ? teamA : teamB;
            return (
              <PlayerList
                key={side}
                header={teamSelect(side, id, side === 'a' ? teamB : teamA)}
                players={rosterPlayers(id)}
                selected={side === 'a' ? sendA : sendB}
                onToggle={toggle(side === 'a' ? setSendA : setSendB)}
                color={COLOR[side]}
                marketValues={data.marketValues}
                empty={id === null ? 'Pick a manager to see their roster.' : null}
              />
            );
          })}
        </div>
        {data.marketValues && (
          <HowItWorks className="-mt-3" label="What the numbers mean">
            <p>
              Each player: points per game this season, expected points per remaining week (half his projection, half his
              season scoring, as the odds model values him), and his{' '}
              <a href="https://fantasycalc.com" target="_blank" rel="noreferrer" className="underline">FantasyCalc</a> redraft
              value (the trade market&apos;s price; kickers and defenses aren&apos;t valued).
            </p>
          </HowItWorks>
        )}

        {trade && (
          <StickyResult
            move={`${nameA} gets ${sendB.length ? list(sendB) : 'nothing'}`}
            before={(worlds ? pickupOdds : baseOdds)?.teams[teamA!]?.playoffs}
            after={(worlds ? tradePickupOdds : tradeOdds)?.teams[teamA!]?.playoffs}
            target={resultsRef}
          />
        )}

        {!trade ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            {teamA === null || teamB === null ? 'Choose both managers, then tap the players each one sends.' : 'Tap the players each manager sends.'}
          </p>
        ) : (
          <>
            <div ref={resultsRef} className="scroll-mt-4 space-y-3 rounded-lg bg-[var(--surface)] p-3 text-sm text-[var(--foreground)]">
              <div>
                <span style={{ color: COLOR.a }} className="font-semibold">{nameA}</span> gets {sendB.length ? sendB.map(playerName).join(', ') : 'nothing'} ·{' '}
                <span style={{ color: COLOR.b }} className="font-semibold">{nameB}</span> gets {sendA.length ? sendA.map(playerName).join(', ') : 'nothing'}
                <button
                  type="button"
                  onClick={() => {
                    setSendA([]);
                    setSendB([]);
                  }}
                  className="ml-3 text-xs text-[var(--muted)] underline"
                >
                  Clear
                </button>
              </div>
              <Switch
                on={compare}
                onChange={setCompare}
                label="Compare with waiver pickups"
                hint="Judge the trade against the free agents each team could add instead, and add after it."
              />
            </div>

            {compare && (
              <WaiverVerdict
                teams={[
                  { id: teamA!, name: nameA, color: COLOR.a },
                  { id: teamB!, name: nameB, color: COLOR.b },
                ]}
                comparison={comparison}
                worlds={worlds}
                odds={{ none: baseOdds, trade: tradeOdds, pickups: pickupOdds, both: tradePickupOdds }}
                list={list}
                end={end}
              />
            )}

            {live && (() => {
              // Sleeper's rule mid-week: a player who has played stays put (with his points) until next week
              const lockedA = lockedMoves(live, sendA);
              const lockedB = lockedMoves(live, sendB);
              const free = [...sendA, ...sendB].filter((p) => !live.locked.includes(p));
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--neutral-bg)] p-3 text-sm text-[var(--foreground)]">
                  <p>
                    <strong>Week {live.week} is under way.</strong> Its games use the live odds, with the points already scored.
                  </p>
                  {lockedA.length + lockedB.length > 0 && (
                    <p className="mt-1">
                      {[lockedA.length ? `${list(lockedA)} (to ${nameB})` : '', lockedB.length ? `${list(lockedB)} (to ${nameA})` : ''].filter(Boolean).join(' and ')}{' '}
                      {lockedA.length + lockedB.length === 1 ? 'has' : 'have'} already played this week, so Sleeper keeps{' '}
                      {lockedA.length + lockedB.length === 1 ? 'him' : 'them'} and the points on the old team until week {live.week + 1}.
                    </p>
                  )}
                  {free.length > 0 && (
                    <p className="mt-1">
                      {list(free)} {free.length === 1 ? "hasn't" : "haven't"} played yet, so {free.length === 1 ? 'he moves' : 'they move'} right away and can
                      start for the new team this week.
                    </p>
                  )}
                </div>
              );
            })()}

            {compare && !worlds ? (
              <p className="text-sm text-[var(--muted)]">Checking the waiver wire…</p>
            ) : (
              <MoveImpact
                data={data}
                teamStats={teamStats}
                sides={sides}
                before={worlds ? { model: worlds.before, odds: pickupOdds } : { model: data.model, odds: baseOdds }}
                after={worlds ? { model: worlds.after, odds: tradePickupOdds } : { model: trade.model, odds: tradeOdds }}
                beforeLabel={worlds ? 'with the best pickups instead of the trade' : 'without the trade'}
              >
                <HowItWorks className="rounded-lg border border-[var(--border)] p-4">
                  <p>
                    The &quot;before&quot; numbers are the Playoffs tab&apos;s: 20,000 simulated seasons on the real schedule, with
                    each team&apos;s strength from its projected lineup and its points per game so far (weights fitted on thousands
                    of other 12-team leagues). The &quot;after&quot; run uses the same random draws, so differences come from the
                    trade, not simulation noise.
                  </p>
                  <p>
                    A trade changes the rosters, so it moves each team&apos;s expected score by the model&apos;s lineup weight times
                    its change in projected lineup (averaged over the remaining regular-season weeks, and separately over the playoff
                    weeks for the playoffs), like any other roster change; points already scored stay with the team. On 28,899
                    teams in real trades in other leagues, a trade&apos;s projected change showed up at 43% (95% 40–46%), close to
                    that weight.
                  </p>
                  <p>
                    Weekly win odds use a model fitted for single games: next week&apos;s lineup counts heavily (byes, injuries and
                    pickups are already in it) and later weeks lean more on points per game, each with that week&apos;s spread. On
                    over a million games in other leagues it beat the earlier weekly odds, next week and further out.
                  </p>
                  {compare && (
                    <p>
                      Compare with waiver pickups: each team takes up to two free agents, one at a time, as long as each adds at
                      least 0.01 expected wins (healthy players only, the best six at each position, each dropping the player who
                      costs the lineup least). That&apos;s done once without the trade and once after it, so &quot;before&quot; is
                      the team with its best pickups and &quot;after&quot; is the trade plus the best pickups it still has room
                      for. The second team can&apos;t take the first team&apos;s pickups. FAAB bids and waiver order aren&apos;t
                      modeled, so a pickup someone else would outbid you for still counts.
                    </p>
                  )}
                  {live && (
                    <p>
                      Week {live.week} is being played, so its games use the Live tab&apos;s odds (points so far plus what each side&apos;s
                      players still to play are expected to add) in the weekly and season odds alike. With the trade, each team&apos;s
                      projected final moves by what it does to the lineup it can still set this week: players who have already
                      played stay where they were until week {live.week + 1}, as Sleeper handles it, and players still to play can
                      start for their new team.
                    </p>
                  )}
                  <p>
                    Trades that leave a roster over the limit drop the player who costs the lineup least; trades that open a spot
                    pick up the free agent who helps the lineup most. Draft picks and FAAB aren&apos;t part of the analyzer.
                  </p>
                </HowItWorks>
              </MoveImpact>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Trade vs waivers

type Odds = OddsResult | null;

/**
 * For each team: expected wins and playoff odds with no moves, with its best pickups, and with the
 * trade (plus the pickups after it), and whether the trade beats what waivers alone would do.
 */
function WaiverVerdict({
  teams,
  comparison,
  worlds,
  odds,
  list,
  end,
}: {
  teams: Array<{ id: number; name: string; color: string }>;
  comparison: WaiverComparison | null;
  worlds: { without: RosterChange[]; withTrade: RosterChange[] } | null;
  odds: { none: Odds; trade: Odds; pickups: Odds; both: Odds };
  list: (ids: string[]) => string;
  end: (text: string) => string;
}) {
  const ready = comparison && worlds && odds.none && odds.pickups && odds.both;
  return (
    <div>
      <h3 className="text-lg font-semibold text-[var(--foreground)]">Trade vs waivers</h3>
      <p className="mb-3 text-sm text-[var(--muted)]">Rest-of-season expected wins and playoff odds for each team, three ways.</p>
      {!ready ? (
        <p className="text-sm text-[var(--muted)]">Checking the waiver wire and simulating…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((t, i) => {
            const none = odds.none!.teams[t.id];
            const pickups = odds.pickups!.teams[t.id];
            const both = odds.both!.teams[t.id];
            const edge = both.expectedWins - pickups.expectedWins;
            const adds = comparison!.without[t.id] ?? [];
            // With no pickup worth making, the trade is up against standing pat
            const alt = adds.length ? 'waivers' : 'no move';
            const verdict =
              Math.abs(edge) < 0.05
                ? { text: `About the same as ${alt}`, tone: 'neutral' }
                : edge > 0
                  ? { text: `Beats ${alt} by ${edge.toFixed(1)} wins`, tone: 'success' }
                  : { text: adds.length ? `Waivers do ${Math.abs(edge).toFixed(1)} wins better` : `Worse than no move by ${Math.abs(edge).toFixed(1)} wins`, tone: 'danger' };
            const after = comparison!.with[t.id] ?? [];
            const drops = (c: RosterChange, from: string[]) => c.dropped.filter((p) => !from.includes(p));
            const cells = [
              { label: 'No moves', wins: none.expectedWins, playoffs: none.playoffs },
              { label: 'Best pickups', wins: pickups.expectedWins, playoffs: pickups.playoffs },
              { label: 'Trade + pickups', wins: both.expectedWins, playoffs: both.playoffs },
            ];
            const best = Math.max(...cells.map((c) => c.wins));
            return (
              <div key={t.id} className="rounded-lg border border-[var(--border)] p-4 text-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold" style={{ color: t.color }}>{t.name}</span>
                  <span
                    className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ backgroundColor: `var(--${verdict.tone}-bg)`, color: `var(--${verdict.tone}-text)` }}
                  >
                    {verdict.text}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {cells.map((c) => (
                    <div key={c.label} className={`rounded-md p-2 ${c.wins === best && cells.filter((x) => x.wins === best).length === 1 ? 'bg-[var(--neutral-bg)]' : ''}`}>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{c.label}</div>
                      <div className="text-lg font-semibold tabular-nums text-[var(--foreground)]">{c.wins.toFixed(1)}</div>
                      <div className="text-xs text-[var(--muted)]">wins · {formatOdds(c.playoffs)} playoffs</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-[var(--muted)]">
                  {adds.length
                    ? end(`Best pickups instead: ${list(adds)}${drops(worlds!.without[i], []).length ? `, dropping ${list(drops(worlds!.without[i], []))}` : ''}`)
                    : 'Without the trade, no free agent would add 0.01 expected wins.'}{' '}
                  {after.length ? end(`After the trade: ${list(after)}`) : adds.length ? 'After the trade, none would.' : ''}
                  {odds.trade && Math.abs(odds.trade.teams[t.id].expectedWins - both.expectedWins) >= 0.05 && (
                    <> The trade alone: {odds.trade.teams[t.id].expectedWins.toFixed(1)} wins ({signed(odds.trade.teams[t.id].expectedWins - none.expectedWins)}).</>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
