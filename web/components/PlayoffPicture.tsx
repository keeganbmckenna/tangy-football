'use client';

import { useEffect, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import BracketBoard, { type BoardColumn, type BoardTeam } from '@/components/BracketBoard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { getHeatmapColorByRatio, RESULT_DOT_COLORS } from '@/lib/constants';
import { formatRecord } from '@/lib/analyze/playEveryone';
import { formatOdds, type OutcomeOdds, type OddsTeam, type PlayoffOddsResponse, type ProjectedBracketGame, type TeamScenarios } from '@/lib/analyze/playoffOdds';
import type { TeamStats } from '@/lib/types';

interface PlayoffPictureProps {
  /** Current season's team stats, for names and divisions */
  teamStats: TeamStats[];
}

const pct = formatOdds;

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
  // Which outcome the "this week: win / loss" column shows
  const [swingOutcome, setSwingOutcome] = useState<keyof OutcomeOdds>('playoffs');

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
    const lastPlaceLine = (): Line | null =>
      o?.lastPlace != null && o.lastPlace >= 0.05
        ? { tone: 'bad', text: `${pct(o.lastPlace)} chance of losing the toilet bowl.` }
        : null;
    if (sc.eliminated) {
      lines.push({ tone: 'bad', text: 'Eliminated from playoff contention.' });
      const lp = lastPlaceLine();
      if (lp) lines.push(lp);
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
    if (o?.champion != null && o.champion >= 0.01) {
      lines.push({ tone: 'good', text: `${pct(o.champion)} chance of winning the league.` });
    }
    const lp = lastPlaceLine();
    if (lp) lines.push(lp);
    return lines;
  };

  /** Now vs after a win / loss this week, for every outcome that this week can change */
  const thisWeekTable = (id: number) => {
    const o = odds[id];
    if (!o || !o.ifWin || !o.ifLoss) return null;
    const game = data.odds!.nextWeekGames.find((g) => g.a === id || g.b === id);
    const opp = game ? (game.a === id ? game.b : game.a) : null;
    const rows: { label: string; now: number; win: number; loss: number; bad?: boolean }[] = [
      { label: 'Playoffs', now: o.playoffs, win: o.ifWin.playoffs, loss: o.ifLoss.playoffs },
      ...(data.format.hasDivisions ? [{ label: 'Division', now: o.division, win: o.ifWin.division, loss: o.ifLoss.division }] : []),
      { label: 'Playoff bye', now: o.bye, win: o.ifWin.bye, loss: o.ifLoss.bye },
      ...(o.champion !== null && o.ifWin.champion !== null && o.ifLoss.champion !== null
        ? [{ label: 'Win the league', now: o.champion, win: o.ifWin.champion, loss: o.ifLoss.champion }]
        : []),
      // A toilet bowl bye is bad: two losses, not three, lose the toilet bowl
      ...(o.toiletBye !== null && o.ifWin.toiletBye !== null && o.ifLoss.toiletBye !== null
        ? [{ label: 'Toilet bowl bye', now: o.toiletBye, win: o.ifWin.toiletBye, loss: o.ifLoss.toiletBye, bad: true }]
        : []),
      ...(o.lastPlace !== null && o.ifWin.lastPlace !== null && o.ifLoss.lastPlace !== null
        ? [{ label: 'Lose the toilet bowl', now: o.lastPlace, win: o.ifWin.lastPlace, loss: o.ifLoss.lastPlace, bad: true }]
        : []),
    ].filter((r) => !(r.win === r.loss && (r.now === 0 || r.now === 1)));
    if (!rows.length) return null;
    // Green for the better result: higher odds, or lower for losing the toilet bowl
    const tone = (r: (typeof rows)[number], v: number, other: number) =>
      v === other ? 'var(--foreground)' : (r.bad ? v < other : v > other) ? RESULT_DOT_COLORS.W : RESULT_DOT_COLORS.L;
    return (
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-xs text-[var(--muted)]">
            <th className="py-1 text-left font-medium">Week {nextWeek}{opp ? ` vs ${name(opp)}` : ''}</th>
            <th className="py-1 text-right font-medium">Now</th>
            <th className="py-1 text-right font-medium">Win</th>
            <th className="py-1 text-right font-medium">Loss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-[var(--border)]">
              <td className="py-1 text-[var(--foreground)]">{r.label}</td>
              <td className="py-1 text-right text-[var(--muted)]">{pct(r.now)}</td>
              <td className="py-1 text-right font-medium" style={{ color: tone(r, r.win, r.loss) }}>{pct(r.win)}</td>
              <td className="py-1 text-right font-medium" style={{ color: tone(r, r.loss, r.win) }}>{pct(r.loss)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
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

  const boardTeam = (side: ProjectedBracketGame['top'], caption: (id: number) => string | null): BoardTeam =>
    'from' in side
      ? { rosterId: null, name: side.from, placeholder: side.from }
      : {
          rosterId: side.rosterId,
          name: name(side.rosterId),
          username: user(side.rosterId),
          avatarUrl: stats.get(side.rosterId)?.avatarUrl,
          seed: side.seed,
          caption: [record(teams.get(side.rosterId)!), caption(side.rosterId)].filter(Boolean).join(' · '),
        };

  /** A projected bracket as board columns, with the byes listed under round 1 */
  const projectedColumns = (
    games: ProjectedBracketGame[],
    rounds: string[],
    byes: number[],
    caption: (id: number) => string | null
  ): BoardColumn[] =>
    rounds.map((round, i) => {
      const roundGames = games.filter((g) => g.label === round);
      return {
        title: round,
        subtitle: roundGames[0] ? `Week ${roundGames[0].week}` : undefined,
        note: i === 0 ? `Byes: ${byes.map((id, j) => `${j + 1}. ${name(id)}`).join(' · ')}` : undefined,
        games: roundGames.map((g, j) => ({
          id: `${round}-${j}`,
          top: boardTeam(g.top, caption),
          bottom: boardTeam(g.bottom, caption),
        })),
      };
    });
  const hasToilet = data.toiletBracket.length > 0 && Object.values(odds).some((o) => o.lastPlace !== null);
  const hasTitle = Object.values(odds).some((o) => o.champion !== null);
  const swingOptions: { key: keyof OutcomeOdds; label: string }[] = [
    { key: 'playoffs', label: 'playoff' },
    ...(data.format.hasDivisions ? [{ key: 'division' as const, label: 'division' }] : []),
    { key: 'bye', label: 'playoff bye' },
    ...(hasTitle ? [{ key: 'champion' as const, label: 'winning the league' }] : []),
    ...(hasToilet ? [{ key: 'toiletBye' as const, label: 'toilet bowl bye' }] : []),
    ...(hasToilet ? [{ key: 'lastPlace' as const, label: 'losing the toilet bowl' }] : []),
  ];
  const swingLabel = swingOptions.find((o) => o.key === swingOutcome)?.label ?? 'playoff';

  return (
    <div className="space-y-8">
      <SectionCard
        title="If the Season Ended Now"
        subtitle={`Seeds after week ${data.lastScoredWeek}: division winners first, then wild cards; ties go to points for`}
        gradientType="primary"
      >
        <div className="p-6 space-y-6">
          <BracketBoard
            columns={projectedColumns(data.bracket, ['Round 1', 'Semifinal', 'Final'], data.seeds.slice(0, 2), (id) =>
              odds[id]
                ? `${pct(odds[id].playoffs)} to make it${odds[id].champion != null ? ` · ${pct(odds[id].champion!)} title` : ''}`
                : null
            )}
          />
          {firstOut.length > 0 && (
            <div className="text-sm text-[var(--muted)]">
              <span className="font-medium text-[var(--foreground)]">First out:</span>{' '}
              {firstOut.map((t) => `${name(t.rosterId)} (${record(t)}, ${t.pointsFor.toFixed(1)} pts)`).join(' · ')}
            </div>
          )}
        </div>
      </SectionCard>

      {hasToilet && (
        <SectionCard
          title="Toilet Bowl If the Season Ended Now"
          subtitle="The six teams out of the playoffs, worst record first (ties go to fewer points for). The lower score advances, and the final's loser loses the toilet bowl."
          gradientType="warning"
        >
          <div className="p-6">
            <BracketBoard
              columns={projectedColumns(data.toiletBracket, ['Round 1', 'Semifinal', 'Last-place game'], data.toiletSeeds.slice(0, 2), (id) =>
                odds[id]?.lastPlace != null ? `${pct(odds[id].lastPlace!)} to lose it` : null
              )}
            />
          </div>
        </SectionCard>
      )}

      {data.odds && (
        <SectionCard
          title="Playoff Odds"
          subtitle={`${data.odds.sims.toLocaleString()} simulations of the remaining ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} on the real schedule`}
          gradientType="info"
          footer={
            <span>
              Each simulated week, a team scores around the strength of its current roster: each player is worth half his
              projection for that week (so byes count) and half his points per game this season, and the team&apos;s best
              lineup of those values sets its expected score, with this season&apos;s week-to-week spread. Backtested on every
              team at every week of 2022–2025, the odds were well calibrated: teams given 50–75% made it 61% of the time,
              teams given 75–95% made it 87% of the time, and no team under 2% made it. Playoff bye odds were
              overconfident in testing, so treat them as rougher. The win/loss column shows the selected odds after a win or a loss
              this week.
              {hasTitle && (
                <> Title odds play out the playoff bracket (weeks {data.playoffWeekStart}–{data.playoffWeekStart + 2}, higher score
                  advances) with the same model.</>
              )}
              {hasToilet && (
                <> Toilet bowl odds play out the toilet bowl too (weeks {data.playoffWeekStart}–{data.playoffWeekStart + 2}) with the same
                  model.</>
              )}
              {(hasTitle || hasToilet) && (
                <> With only four past champions and toilet bowl losers, these couldn&apos;t be backtested, so treat them as a rough
                  guide.</>
              )}
            </span>
          }
        >
          <label className="flex flex-wrap items-center gap-2 px-6 pt-4 text-sm text-[var(--foreground)]">
            How a win or loss in week {nextWeek} changes
            <select
              value={swingOutcome}
              onChange={(e) => setSwingOutcome(e.target.value as keyof OutcomeOdds)}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              {swingOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
            odds
          </label>
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
                  <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Playoff bye*</th>
                  {hasTitle && (
                    <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Title</th>
                  )}
                  {hasToilet && (
                    <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Lose toilet bowl</th>
                  )}
                  <th className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                    Week {nextWeek}: win / loss
                    <div className="normal-case tracking-normal">{swingLabel}</div>
                  </th>
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
                      {hasTitle && <OddsCell p={o?.champion ?? 0} />}
                      {hasToilet && <OddsCell p={o?.lastPlace ?? 0} />}
                      <td className="px-3 py-2 whitespace-nowrap text-center text-sm">
                        {o && o.ifWin !== null && o.ifLoss !== null && o.ifWin[swingOutcome] !== null && o.ifLoss[swingOutcome] !== null ? (
                          <>
                            <span style={{ color: RESULT_DOT_COLORS.W }}>{pct(o.ifWin[swingOutcome]!)}</span>
                            <span className="text-[var(--muted)]"> / </span>
                            <span style={{ color: RESULT_DOT_COLORS.L }}>{pct(o.ifLoss[swingOutcome]!)}</span>
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
                {thisWeekTable(t.rosterId)}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
