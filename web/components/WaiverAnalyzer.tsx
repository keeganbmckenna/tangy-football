'use client';

import { useMemo, useRef, useState } from 'react';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useModelOdds, useOddsSimulator } from '@/hooks/useOddsSimulator';
import SectionCard from '@/components/ui/SectionCard';
import HowItWorks from '@/components/ui/HowItWorks';
import PlayerList from '@/components/ui/PlayerList';
import Capped from '@/components/ui/Capped';
import StickyResult from '@/components/ui/StickyResult';
import { PositionChips, positionsOf } from '@/components/ui/FinderFilters';
import MoveImpact from '@/components/MoveImpact';
import { lockedMoves, meansAfterTrade, rosterAfterTrade, type TradeDataResponse, type TradePlayerInfo } from '@/lib/analyze/trade';
import type { TeamStats } from '@/lib/types';

export interface WaiverPreset {
  me: number;
  add: string[];
  drop: string[];
}

const ADD = 'var(--success-text)';
const DROP = 'var(--danger-text)';
const TEAM = 'var(--trade-a)';
const FREE_AGENTS_SHOWN = 12;

/**
 * Waiver Analyzer: one team's pickups and drops, and what they do to its week-by-week win odds,
 * its season odds and its lineup (the trade analyzer's views, for a move that changes one roster).
 */
export default function WaiverAnalyzer({ data, teamStats, initial = null }: { data: TradeDataResponse; teamStats: TeamStats[]; initial?: WaiverPreset | null }) {
  const myTeam = useMyTeam();
  const [me, setMe] = useState<number | null>(initial?.me ?? myTeam.rosterId);
  const [adds, setAdds] = useState<string[]>(initial?.add ?? []);
  const [drops, setDrops] = useState<string[]>(initial?.drop ?? []);
  const [positions, setPositions] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const simulate = useOddsSimulator(data);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const { inputs } = data;
  const name = (id: number | null) => teamStats.find((t) => t.rosterId === id)?.username.trim() ?? (id === null ? '' : `Team ${id}`);
  const playerName = (id: string) => data.players[id]?.name ?? id;
  const list = (ids: string[]) => {
    const names = ids.map(playerName);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  };
  const live = data.model.live;

  const move = useMemo(() => {
    if (me === null || adds.length + drops.length === 0) return null;
    // Pickups stay; a full roster makes room by dropping the player who costs the lineup least
    const c = rosterAfterTrade(inputs, { rosterId: me, sends: drops, receives: adds, keep: adds, fill: false });
    const change = { ...c, dropped: [...drops, ...c.dropped], added: adds };
    const { model } = meansAfterTrade(data.model, inputs, [change]);
    return { key: `${data.generatedAt}|${me}|+${[...adds].sort().join(',')}|-${[...drops].sort().join(',')}`, change, auto: c.dropped, model };
  }, [data, inputs, me, adds, drops]);

  const baseOdds = useModelOdds(simulate, data.generatedAt, data.model);
  const afterOdds = useModelOdds(simulate, move?.key ?? null, move?.model ?? null);

  const toggle = (setter: (f: (s: string[]) => string[]) => void) => (id: string) => setter((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const roster = me === null ? [] : (inputs.rosters[me] ?? []).map((p) => data.players[p]).filter((p): p is TradePlayerInfo => !!p);
  const faPositions = positionsOf(inputs.freeAgents.map((p) => inputs.positions[p]).filter(Boolean));
  const q = query.trim().toLowerCase();
  // Picked free agents first, then the best by expected points
  const freeAgents = inputs.freeAgents
    .map((p) => data.players[p])
    .filter((p): p is TradePlayerInfo => !!p)
    .filter((p) => adds.includes(p.id) || ((!positions.length || positions.includes(p.position)) && (!q || p.name.toLowerCase().includes(q))))
    .sort((a, b) => Number(adds.includes(b.id)) - Number(adds.includes(a.id)) || b.expectedPerWeek - a.expectedPerWeek);
  const open = move ? drops.length - adds.length + move.auto.length : 0;
  const locked = lockedMoves(live, adds);

  return (
    <SectionCard title="Waiver Analyzer" subtitle="Pick free agents to add and players to drop, and see what the move does to your weeks and your season." gradientType="info">
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="waiver-analyzer-team">Your team</label>
          <select
            id="waiver-analyzer-team"
            value={me ?? ''}
            onChange={(e) => {
              setMe(e.target.value ? Number(e.target.value) : null);
              setDrops([]);
            }}
            className="min-w-[12rem] rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--foreground)]"
          >
            <option value="">Choose your team</option>
            {[...teamStats]
              .sort((x, y) => x.username.localeCompare(y.username, undefined, { sensitivity: 'base' }))
              .map((t) => (
                <option key={t.rosterId} value={t.rosterId}>
                  {t.username}
                </option>
              ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0">
          <Capped items={freeAgents} initial={Math.max(FREE_AGENTS_SHOWN, adds.length)}>
            {(shown) => (
              <PlayerList
                header={
                  <div className="space-y-2">
                    <div className="text-sm font-semibold text-[var(--foreground)]">
                      Free agents <span className="font-normal text-[var(--muted)]">· tap to add</span>
                    </div>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search free agents"
                      aria-label="Search free agents"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--foreground)]"
                    />
                    <PositionChips positions={faPositions} value={positions} onChange={setPositions} label="Free agent positions" />
                  </div>
                }
                players={shown}
                selected={adds}
                onToggle={toggle(setAdds)}
                color={ADD}
                marketValues={data.marketValues}
                byPosition={false}
                empty={freeAgents.length ? null : 'No free agents match.'}
              />
            )}
          </Capped>
          </div>
          <PlayerList
            header={
              <div className="text-sm font-semibold text-[var(--foreground)]">
                {me === null ? 'Your roster' : name(me)} <span className="font-normal text-[var(--muted)]">· tap to drop</span>
              </div>
            }
            players={roster}
            selected={drops}
            onToggle={toggle(setDrops)}
            color={DROP}
            marketValues={data.marketValues}
            empty={me === null ? 'Pick your team to see your roster.' : null}
          />
        </div>

        {move && me !== null && (
          <StickyResult
            move={[adds.length ? `Add ${list(adds)}` : '', move.change.dropped.length ? `Drop ${list(move.change.dropped)}` : ''].filter(Boolean).join(' · ')}
            before={baseOdds?.teams[me]?.playoffs}
            after={afterOdds?.teams[me]?.playoffs}
            target={resultsRef}
          />
        )}

        {!move ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            {me === null
              ? 'Choose your team, then tap the free agents to add.'
              : 'Tap the free agents to add. If your roster is full, the player who costs your lineup least is dropped, unless you pick who goes.'}
          </p>
        ) : (
          <>
            <div ref={resultsRef} className="scroll-mt-4 rounded-lg bg-[var(--surface)] p-3 text-sm text-[var(--foreground)]">
              {adds.length > 0 && (
                <span>
                  <span className="font-semibold" style={{ color: ADD }}>Add</span> {list(adds)}
                </span>
              )}
              {adds.length > 0 && move.change.dropped.length > 0 && ' · '}
              {move.change.dropped.length > 0 && (
                <span>
                  <span className="font-semibold" style={{ color: DROP }}>Drop</span> {list(move.change.dropped)}
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setAdds([]);
                  setDrops([]);
                }}
                className="ml-3 text-xs text-[var(--muted)] underline"
              >
                Clear
              </button>
              {move.auto.length > 0 && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Your roster is full, so {list(move.auto)} {move.auto.length === 1 ? 'goes' : 'go'}: the {move.auto.length === 1 ? 'player' : 'players'} your
                  lineup misses least. Tap someone on your roster to drop them instead.
                </p>
              )}
              {open > 0 && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Leaves {open} roster spot{open === 1 ? '' : 's'} open.
                </p>
              )}
              {locked.length > 0 && (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {list(locked)} {locked.length === 1 ? 'has' : 'have'} already played in week {live!.week}, so {locked.length === 1 ? 'he counts' : 'they count'} from week{' '}
                  {live!.week + 1}.
                </p>
              )}
            </div>

            <MoveImpact
              data={data}
              teamStats={teamStats}
              sides={[{ rosterId: me!, name: name(me), color: TEAM, change: move.change, sent: [], received: [] }]}
              before={{ model: data.model, odds: baseOdds }}
              after={{ model: move.model, odds: afterOdds }}
              beforeLabel="without the move"
            >
              <HowItWorks className="rounded-lg border border-[var(--border)] p-4">
                <p>
                  The &quot;before&quot; numbers are the Playoffs tab&apos;s: 20,000 simulated seasons on the real schedule. The
                  &quot;after&quot; run uses the same random draws with your roster changed, so the differences come from the move.
                  A pickup moves your expected score by the model&apos;s lineup weight times the change in your projected lineup,
                  like a trade does; points already scored stay.
                </p>
                <p>
                  Each player&apos;s expected points per week are half his projection and half his scoring this season, with byes
                  counted. Only your team changes directly; other teams&apos; odds move through who they play and the playoff race.
                  FAAB bids and waiver order aren&apos;t modeled, and recently dropped players may still be on waivers.
                </p>
                {live && (
                  <p>
                    Week {live.week} is being played: its game uses the Live tab&apos;s odds, and a free agent whose game has started
                    can&apos;t help you until week {live.week + 1}.
                  </p>
                )}
              </HowItWorks>
            </MoveImpact>
          </>
        )}
      </div>
    </SectionCard>
  );
}
