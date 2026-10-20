'use client';

import { useEffect, useRef, useState } from 'react';
import { useMyTeam } from '@/hooks/useMyTeam';
import SectionCard from '@/components/ui/SectionCard';
import { bestLineup, formatOdds } from '@/lib/analyze/playoffOdds';
import type { TradeDataResponse } from '@/lib/analyze/trade';
import type { WaiverPickup, WaiverProgress, WaiverTarget } from '@/lib/analyze/waiverFinder';
import type { WaiverMessage, WaiverRequest } from '@/lib/analyze/waiverFinder.worker';
import type { TeamStats } from '@/lib/types';

interface WaiverFinderProps {
  data: TradeDataResponse;
  teamStats: TeamStats[];
}

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

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

export default function WaiverFinder({ data, teamStats }: WaiverFinderProps) {
  // Starts on your team, if you've picked one in the header
  const myTeam = useMyTeam();
  const [me, setMe] = useState<number | null>(myTeam.rosterId);
  const [target, setTarget] = useState<WaiverTarget>('season');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<WaiverProgress | null>(null);
  const [results, setResults] = useState<{ me: number; target: WaiverTarget; pickups: WaiverPickup[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);

  const { inputs } = data;
  const manager = (id: number) => teamStats.find((t) => t.rosterId === id)?.username.trim() ?? `Team ${id}`;
  const player = (id: string) => data.players[id];
  const label = (id: string) => {
    const p = player(id);
    return p ? `${p.name} (${p.position})` : id;
  };

  // Remaining weeks, each with the opponent and which of this team's starters are on bye
  const weeks =
    me === null
      ? []
      : data.remaining
          .filter((g) => g.a === me || g.b === me)
          .sort((a, b) => a.week - b.week)
          .map((g) => {
            const roster = inputs.rosters[me] ?? [];
            const season = Object.fromEntries(
              roster.filter((p) => inputs.positions[p]).map((p) => [p, { position: inputs.positions[p], points: data.players[p]?.expectedPerWeek ?? 0 }])
            );
            const starters = bestLineup(roster, season, inputs.rosterPositions).starters.map((s) => s.playerId);
            const byes = starters.filter((p) => data.players[p]?.byeWeek === g.week).map((p) => data.players[p].name);
            return { week: g.week, opponent: g.a === me ? g.b : g.a, byes };
          });

  const run = (team: number, t: WaiverTarget) => {
    worker.current?.terminate();
    setRunning(true);
    setError(null);
    setProgress(null);
    let w: Worker;
    try {
      w = new Worker(new URL('../lib/analyze/waiverFinder.worker.ts', import.meta.url));
    } catch {
      setRunning(false);
      setError('Your browser can’t run the waiver finder in the background.');
      return;
    }
    worker.current = w;
    w.onmessage = (e: MessageEvent<WaiverMessage>) => {
      const msg = e.data;
      if (msg.type === 'progress') setProgress(msg.progress);
      else if (msg.type === 'done') {
        setResults({ me: team, target: t, pickups: msg.results });
        setRunning(false);
        w.terminate();
      } else {
        setError(msg.message);
        setRunning(false);
        w.terminate();
      }
    };
    const request: WaiverRequest = { data, me: team, options: { target: t } };
    w.postMessage(request);
  };

  const pct = progress && progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <SectionCard
      title="Waiver Finder"
      subtitle="The free agents who would help your team most, over the rest of the season or in one week (like a bye)."
      gradientType="info"
    >
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="waiver-team">Your team</label>
          <select
            id="waiver-team"
            value={me ?? ''}
            onChange={(e) => {
              setMe(e.target.value ? Number(e.target.value) : null);
              setTarget('season');
              setResults(null);
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
          <label className="sr-only" htmlFor="waiver-target">Optimize for</label>
          <select
            id="waiver-target"
            value={target}
            disabled={me === null}
            onChange={(e) => {
              const t: WaiverTarget = e.target.value === 'season' ? 'season' : Number(e.target.value);
              setTarget(t);
              if (me !== null && results && !running) run(me, t);
            }}
            className="min-w-[12rem] max-w-full rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1.5 text-sm text-[var(--foreground)] disabled:opacity-50"
          >
            <option value="season">Rest of season</option>
            {weeks.map((w) => (
              <option key={w.week} value={w.week}>
                Week {w.week} vs {manager(w.opponent)}
                {w.byes.length ? ` (byes: ${w.byes.join(', ')})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={me === null || running}
            onClick={() => me !== null && run(me, target)}
            className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Find pickups
          </button>
        </div>

        {running && (
          <div>
            <div className="mb-1 text-xs text-[var(--muted)]">
              {progress?.stage === 'simulating' ? 'Simulating the best pickups’ seasons' : 'Checking every free agent'}…
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--neutral-bg)]">
              <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}

        {results && !running && (
          <div className="space-y-3">
            {results.pickups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
                No free agent would help {manager(results.me)}
                {typeof results.target === 'number' ? ` in week ${results.target}` : ' over the rest of the season'}.
              </p>
            ) : (
              results.pickups.map((r) => {
                const p = player(r.add);
                return (
                  <div key={r.add} className="rounded-lg border border-[var(--border)] p-4 text-sm">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--success-text)]">Add</div>
                        <div className="font-semibold text-[var(--foreground)]">{label(r.add)}</div>
                        {p && (
                          <div className="text-xs text-[var(--muted)]">
                            {p.team ?? 'FA'}
                            {p.seasonPerGame !== null ? ` · ${p.seasonPerGame.toFixed(1)} ppg` : ''}
                            {` · ${p.expectedPerWeek.toFixed(1)}/wk expected`}
                            {p.byeWeek ? ` · bye week ${p.byeWeek}` : ''}
                            {p.injury ? <span className="ml-1 font-semibold text-[var(--danger-text)]">{p.injury}</span> : null}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--danger-text)]">Drop</div>
                        <div className="text-[var(--foreground)]">{r.drop.length ? r.drop.map(label).join(', ') : 'Nobody (open roster spot)'}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      {r.week && (
                        <div className="sm:col-span-2">
                          <span className="mr-1 text-xs text-[var(--muted)]">
                            Week {r.week.week} vs {manager(r.week.opponent)}
                          </span>
                          <Change before={r.week.winBefore} after={r.week.winAfter} />
                          <span className="ml-2 text-xs text-[var(--muted)]">
                            (lineup {signed(r.week.lineupAfter - r.week.lineupBefore)} pts)
                          </span>
                        </div>
                      )}
                      <div><span className="mr-1 text-xs text-[var(--muted)]">Playoffs</span><Change before={r.odds[0].playoffs} after={r.odds[1].playoffs} /></div>
                      {r.odds[0].champion !== null && r.odds[1].champion !== null && (
                        <div><span className="mr-1 text-xs text-[var(--muted)]">Title</span><Change before={r.odds[0].champion} after={r.odds[1].champion} /></div>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Expected lineup over the rest of the season: {signed(r.lineup[1] - r.lineup[0])} pts/wk
                    </p>
                  </div>
                );
              })
            )}
          </div>
        )}

        <details className="rounded-lg border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          <summary className="cursor-pointer font-medium text-[var(--foreground)]">How this works</summary>
          <div className="mt-3 space-y-2">
            <p>
              It checks the 15 best free agents at every position (kickers and defenses included). Each pickup drops the
              player whose loss hurts your lineup least over the rest of the season (players in IR slots stay), so a one-week
              fill never costs you more later than it has to.
            </p>
            <p>
              Rest of season ranks pickups by how much they raise your playoff and title odds. A single week ranks them by your
              win odds that week, and still shows each pickup&apos;s season effect: if the drop hurts later, you&apos;ll see it
              there. The best dozen get 5,000 simulated seasons on the same random draws as without the move. At most 3 pickups
              per position are shown.
            </p>
            <p>
              Projections more than a week or two out are mostly each player&apos;s general outlook with his bye week counted,
              so they&apos;re good for planning around byes but not matchup-specific. FAAB bids and waiver priority aren&apos;t
              modeled, and recently dropped players may still be on waivers.
            </p>
          </div>
        </details>
      </div>
    </SectionCard>
  );
}
