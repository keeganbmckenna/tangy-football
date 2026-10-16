'use client';

import { useEffect, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { getHeatmapColorByRatio, RESULT_DOT_COLORS } from '@/lib/constants';
import { formatRecord } from '@/lib/analyze/playEveryone';
import type { OddsTeam, PlayoffOddsResponse, ProjectedBracketGame, TeamScenarios } from '@/lib/analyze/playoffOdds';
import type { TeamStats } from '@/lib/types';

interface PlayoffPictureProps {
  /** Current season's team stats, for names and divisions */
  teamStats: TeamStats[];
}

const pct = (p: number) => {
  if (p >= 0.995 && p < 1) return '>99%';
  if (p > 0 && p < 0.005) return '<1%';
  return `${Math.round(p * 100)}%`;
};

type Tone = 'good' | 'bad' | 'neutral';
interface Line {
  tone: Tone;
  text: string;
}

const TONE_COLOR: Record<Tone, string> = {
  good: RESULT_DOT_COLORS.W,
  bad: RESULT_DOT_COLORS.L,
  neutral: 'var(--muted)',
};

function OddsCell({ p, muted = false }: { p: number; muted?: boolean }) {
  const { backgroundColor, textColor } = getHeatmapColorByRatio(p);
  return (
    <td
      className={`px-3 py-2 whitespace-nowrap text-center text-sm font-semibold ${muted ? 'opacity-80' : ''}`}
      style={{ backgroundColor, color: textColor }}
    >
      {pct(p)}
    </td>
  );
}

export default function PlayoffPicture({ teamStats }: PlayoffPictureProps) {
  const [data, setData] = useState<PlayoffOddsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/playoff-odds')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load playoff odds');
        return res.json() as Promise<PlayoffOddsResponse>;
      })
      .then((json) => !cancelled && setData(json))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load playoff odds'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <SectionCard title="Playoff Picture" gradientType="primary">
        <p className="px-6 py-8 text-[var(--muted)]">Couldn&apos;t load the playoff picture: {error}</p>
      </SectionCard>
    );
  }
  if (!data) return <LoadingSpinner message="Simulating the rest of the season..." />;
  if (data.status !== 'in_progress') return null;

  const stats = new Map(teamStats.map((t) => [t.rosterId, t]));
  const teams = new Map(data.teams.map((t) => [t.rosterId, t]));
  const name = (id: number) => stats.get(id)?.teamName ?? `Team ${id}`;
  const user = (id: number) => stats.get(id)?.username ?? '';
  const record = (t: OddsTeam) => formatRecord(t.wins, t.losses, t.ties);
  const seedOf = new Map(data.seeds.map((id, i) => [id, i + 1]));
  const divisionWinners = new Set(data.divisionWinners);
  const odds = data.odds?.teams ?? {};
  const ranked = [...data.teams].sort(
    (a, b) => (odds[b.rosterId]?.playoffs ?? 0) - (odds[a.rosterId]?.playoffs ?? 0) || (seedOf.get(a.rosterId) ?? 99) - (seedOf.get(b.rosterId) ?? 99)
  );
  const firstOut = [...data.teams]
    .filter((t) => !seedOf.has(t.rosterId))
    .sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || b.pointsFor - a.pointsFor)
    .slice(0, 3);
  const weeksLeft = data.remainingWeeks;
  const nextWeek = data.lastScoredWeek + 1;

  const linesFor = (id: number): Line[] => {
    const sc: TeamScenarios | undefined = data.scenarios[id];
    const o = odds[id];
    const lines: Line[] = [];
    if (!sc) return lines;
    if (sc.clinchedDivision) lines.push({ tone: 'good', text: 'Clinched the division (a top-3 seed).' });
    else if (sc.clinchedPlayoffs) lines.push({ tone: 'good', text: 'Clinched a playoff spot.' });
    if (sc.eliminated) {
      lines.push({ tone: 'bad', text: 'Eliminated from playoff contention.' });
      return lines;
    }
    if (sc.eliminatedFromDivision && !sc.clinchedPlayoffs && data.format.hasDivisions) {
      lines.push({ tone: 'neutral', text: 'Can no longer win the division: the wild card is the only way in.' });
    }

    if (sc.exact && !sc.clinchedPlayoffs) {
      if (sc.winOutAndIn) lines.push({ tone: 'good', text: 'Controls its own destiny: win out and it’s in.' });
      else if (sc.winOutPointsAtWorst) lines.push({ tone: 'neutral', text: 'Win out and at worst it comes down to points for.' });
      if (!sc.winOutAndIn && sc.helpNeeded.length) {
        const help = sc.helpNeeded
          .slice(0, 3)
          .map((h) => `${name(h.winner)} beating ${name(h.loser)} (week ${h.week})`)
          .join(', or ');
        lines.push({ tone: 'neutral', text: `Winning out isn’t enough alone. Any one of these clinches it with wins: ${help}.` });
      } else if (!sc.winOutAndIn && !sc.winOutPointsAtWorst) {
        lines.push({ tone: 'bad', text: 'Needs to win and get help from several other results.' });
      }
    }
    if (sc.exact && data.format.hasDivisions && !sc.clinchedDivision && !sc.eliminatedFromDivision && sc.winOutAndDivision) {
      lines.push({ tone: 'good', text: 'Win out and the division is theirs.' });
    }

    for (const race of data.pointsRaces[id] ?? []) {
      const gap = Math.abs(race.margin).toFixed(1);
      const what = race.kind === 'division' ? 'the division lead' : 'the last playoff spot';
      if (race.margin >= 0) {
        lines.push({ tone: 'neutral', text: `Level on record with ${name(race.rival)} for ${what}, ahead on points by ${gap}.` });
      } else {
        const perWeek = weeksLeft > 0 ? ` (${(Math.abs(race.margin) / weeksLeft).toFixed(1)} a week more than them over ${weeksLeft} weeks)` : '';
        lines.push({ tone: 'neutral', text: `Level on record with ${name(race.rival)} for ${what}, behind on points by ${gap}${perWeek}.` });
      }
    }

    if (o && o.ifWin !== null && o.ifLoss !== null && !sc.clinchedPlayoffs) {
      const game = data.odds!.nextWeekGames.find((g) => g.a === id || g.b === id);
      const opp = game ? (game.a === id ? game.b : game.a) : null;
      lines.push({
        tone: 'neutral',
        text: `Week ${nextWeek}${opp ? ` vs ${name(opp)}` : ''}: a win → ${pct(o.ifWin)}, a loss → ${pct(o.ifLoss)}.`,
      });
      // Biggest rooting interest among other games this week
      let best: { text: string; swing: number } | null = null;
      for (const g of data.odds!.nextWeekGames) {
        if (g.a === id || g.b === id) continue;
        const swing = g.ifAWins[id] - g.ifBWins[id];
        if (Math.abs(swing) >= 0.03 && (!best || Math.abs(swing) > best.swing)) {
          const [fav, other] = swing > 0 ? [g.a, g.b] : [g.b, g.a];
          best = { text: `Root for ${name(fav)} over ${name(other)} (${pct(Math.max(g.ifAWins[id], g.ifBWins[id]))} vs ${pct(Math.min(g.ifAWins[id], g.ifBWins[id]))}).`, swing: Math.abs(swing) };
        }
      }
      if (best) lines.push({ tone: 'neutral', text: best.text });
    }
    return lines;
  };

  const status = (id: number) => {
    const sc = data.scenarios[id];
    if (sc?.clinchedDivision) return { label: 'Clinched division', tone: 'good' as Tone };
    if (sc?.clinchedPlayoffs) return { label: 'Clinched', tone: 'good' as Tone };
    if (sc?.eliminated) return { label: 'Eliminated', tone: 'bad' as Tone };
    return null;
  };

  const teamLabel = (id: number) => (
    <>
      <div className="text-sm font-medium text-[var(--foreground)]">{name(id)}</div>
      <div className="text-xs text-[var(--muted)]">@{user(id)}</div>
    </>
  );

  const slot = (side: ProjectedBracketGame['top']) =>
    'from' in side ? (
      <div className="text-sm italic text-[var(--muted)]">{side.from}</div>
    ) : (
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--neutral-bg)] text-[10px] font-bold text-[var(--foreground)]">
          {side.seed}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[var(--foreground)]">{name(side.rosterId)}</div>
          <div className="text-xs text-[var(--muted)]">
            {record(teams.get(side.rosterId)!)}
            {odds[side.rosterId] && <> · {pct(odds[side.rosterId].playoffs)} to make it</>}
          </div>
        </div>
      </div>
    );

  const rounds = ['Round 1', 'Semifinal', 'Final'];

  return (
    <div className="space-y-8">
      <SectionCard
        title="If the Season Ended Now"
        subtitle={`Seeds after week ${data.lastScoredWeek}: division winners first, then wild cards; ties go to points for`}
        gradientType="primary"
      >
        <div className="p-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            {rounds.map((round) => {
              const games = data.bracket.filter((g) => g.label === round);
              return (
                <div key={round} className="space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--foreground)]">{round}</div>
                    <div className="text-xs text-[var(--muted)]">Week {games[0]?.week}</div>
                  </div>
                  {round === 'Round 1' && (
                    <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted)]">
                      Byes: {data.seeds.slice(0, 2).map((id, i) => `${i + 1}. ${name(id)}`).join(' · ')}
                    </div>
                  )}
                  {games.map((g, i) => (
                    <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
                      {slot(g.top)}
                      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">vs</div>
                      {slot(g.bottom)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {firstOut.length > 0 && (
            <div className="text-sm text-[var(--muted)]">
              <span className="font-medium text-[var(--foreground)]">First out:</span>{' '}
              {firstOut.map((t) => `${name(t.rosterId)} (${record(t)}, ${t.pointsFor.toFixed(1)} pts)`).join(' · ')}
            </div>
          )}
        </div>
      </SectionCard>

      {data.odds && (
        <SectionCard
          title="Playoff Odds"
          subtitle={`${data.odds.sims.toLocaleString()} simulations of the remaining ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} on the real schedule`}
          gradientType="info"
          footer={
            <span>
              Each simulated week, a team scores around a strength that is 75% its projected best lineup for that week
              (so byes count) and 25% its scoring this season, with this season&apos;s week-to-week spread. Backtested on
              2022–2025, these odds beat reading the standings by 30–50% (Brier score) and were well calibrated: teams
              given 40–60% made it 51% of the time, teams given 80–95% made it 88% of the time. Bye odds were overconfident
              in testing, so treat them as rougher. The win/loss column shows the odds after a win or a loss this week.
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)]">
              <thead className="bg-[var(--surface)]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Team</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Record</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Now</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Playoffs</th>
                  {data.format.hasDivisions && (
                    <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Division</th>
                  )}
                  <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Bye*</th>
                  <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Week {nextWeek}: win / loss</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {ranked.map((t) => {
                  const o = odds[t.rosterId];
                  const seed = seedOf.get(t.rosterId);
                  const st = status(t.rosterId);
                  return (
                    <tr key={t.rosterId}>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {teamLabel(t.rosterId)}
                        {st && (
                          <span className="text-xs font-medium" style={{ color: TONE_COLOR[st.tone] }}>{st.label}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center text-sm text-[var(--foreground)]">
                        {record(t)}
                        <div className="text-xs text-[var(--muted)]">{t.pointsFor.toFixed(1)} pts</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center text-sm text-[var(--foreground)]">
                        {seed ? (
                          <>
                            Seed {seed}
                            <div className="text-xs text-[var(--muted)]">{divisionWinners.has(t.rosterId) ? 'Division leader' : 'Wild card'}</div>
                          </>
                        ) : (
                          <span className="text-[var(--muted)]">Out</span>
                        )}
                      </td>
                      <OddsCell p={o?.playoffs ?? 0} />
                      {data.format.hasDivisions && <OddsCell p={o?.division ?? 0} />}
                      <OddsCell p={o?.bye ?? 0} muted />
                      <td className="px-3 py-2 whitespace-nowrap text-center text-sm">
                        {o && o.ifWin !== null && o.ifLoss !== null ? (
                          <>
                            <span style={{ color: RESULT_DOT_COLORS.W }}>{pct(o.ifWin)}</span>
                            <span className="text-[var(--muted)]"> / </span>
                            <span style={{ color: RESULT_DOT_COLORS.L }}>{pct(o.ifLoss)}</span>
                          </>
                        ) : (
                          <span className="text-[var(--muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="What Each Team Needs"
        subtitle={
          Object.values(data.scenarios).some((s) => s.exact)
            ? `Every remaining result checked (${weeksLeft} week${weeksLeft === 1 ? '' : 's'} left)`
            : `Exact scenarios start with 3 weeks left; until then clinches and eliminations are only called when certain`
        }
        gradientType="success"
        footer={
          <span>
            Clinched and eliminated are certain, not simulated: they hold however the remaining games and points go. Ties on
            record are broken by points for, so &quot;comes down to points&quot; means it depends on who outscores whom. The
            this-week lines come from the simulation.
          </span>
        }
      >
        <div className="grid gap-4 p-6 md:grid-cols-2">
          {ranked.map((t) => {
            const lines = linesFor(t.rosterId);
            return (
              <div key={t.rosterId} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>{teamLabel(t.rosterId)}</div>
                  <div className="text-right text-sm">
                    <div className="font-semibold text-[var(--foreground)]">{record(t)}</div>
                    {odds[t.rosterId] && <div className="text-xs text-[var(--muted)]">{pct(odds[t.rosterId].playoffs)} playoffs</div>}
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {lines.length ? (
                    lines.map((l, i) => (
                      <li key={i} className="flex gap-2 text-sm text-[var(--foreground)]">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TONE_COLOR[l.tone] }} />
                        <span>{l.text}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-[var(--muted)]">Nothing decided yet.</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
