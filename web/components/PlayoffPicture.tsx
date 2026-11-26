'use client';

import { useState, type CSSProperties } from 'react';
import { usePlayoffOdds } from '@/hooks/useOddsData';
import SectionCard from '@/components/ui/SectionCard';
import RetryButton from '@/components/ui/RetryButton';
import BracketBoard, { type BoardColumn, type BoardTeam } from '@/components/BracketBoard';
import OddsHistoryChart from '@/components/OddsHistoryChart';
import GamesAhead from '@/components/GamesAhead';
import WhatIf from '@/components/WhatIf';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import SortableTh, { SortStatus } from '@/components/ui/SortableTh';
import { AccuracyLink } from '@/components/OddsAccuracy';
import TeamName, { PIN_TD, PIN_TH } from '@/components/ui/TeamName';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnPicker, type PickableColumn } from '@/hooks/useColumnPicker';
import ColumnChips from '@/components/ui/ColumnChips';
import { recordValue, sortKeys, sortRows } from '@/lib/tableSort';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { getHeatmapColorByRatio, RESULT_DOT_COLORS } from '@/lib/constants';
import { formatRecord } from '@/lib/analyze/playEveryone';
import { formatOdds, type OutcomeOdds, type OddsTeam, type ProjectedBracketGame, type TeamScenarios } from '@/lib/analyze/playoffOdds';
import type { TeamStats } from '@/lib/types';
import { pointsChange } from '@/lib/format';

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

/** Columns a phone can add to the odds table */
const ODDS_COLUMNS: PickableColumn[] = [
  { key: 'record', label: 'Record' },
  { key: 'seed', label: 'Current seed' },
];

function OddsCell({ p, muted = false }: { p: number; muted?: boolean }) {
  const { backgroundColor, textColor } = getHeatmapColorByRatio(p);
  return (
    <td
      className={`heat-cell px-3 py-2 whitespace-nowrap text-center text-sm font-semibold ${muted ? 'opacity-80' : ''}`}
      style={{ backgroundColor, color: textColor }}
    >
      {pct(p)}
    </td>
  );
}

export default function PlayoffPicture({ teamStats }: PlayoffPictureProps) {
  // Which outcome the "this week: win / loss" column shows
  const [swingOutcome, setSwingOutcome] = useState<keyof OutcomeOdds>('playoffs');
  const sort = useTableSort('playoffOdds');
  const cols = useColumnPicker('playoff-odds', ODDS_COLUMNS, sortKeys(sort.state));
  const me = useMyTeam();

  const { data, error, retry } = usePlayoffOdds();

  if (error) {
    return (
      <SectionCard title="Playoff Picture" gradientType="primary">
        <div className="px-6 py-8">
          <p className="text-[var(--muted)]">Couldn&apos;t load the playoff picture: {error}</p>
          <RetryButton onClick={retry} />
        </div>
      </SectionCard>
    );
  }
  if (!data) {
    // The odds card's placeholder, then the room the cards below it take (they come with the same
    // data), about a 12-team league's worth scaled by teams, so the cards after them don't jump
    return (
      <div className="space-y-8">
        <LoadingSpinner title="Playoff Odds" gradientType="info" height={{ phone: 970, wide: 885, from: 'sm' }} message="Simulating the rest of the season..." />
        <div
          aria-hidden="true"
          className="h-[var(--rest-h)] md:h-[var(--rest-wide-h)]"
          style={{ '--rest-h': `${teamStats.length * 487}px`, '--rest-wide-h': `${teamStats.length * 395}px` } as CSSProperties}
        />
      </div>
    );
  }
  if (data.status !== 'in_progress') return null;

  const stats = new Map(teamStats.map((t) => [t.rosterId, t]));
  const teams = new Map(data.teams.map((t) => [t.rosterId, t]));
  const name = (id: number) => stats.get(id)?.teamName ?? `Team ${id}`;
  const user = (id: number) => stats.get(id)?.username ?? '';
  const record = (t: OddsTeam) => formatRecord(t.wins, t.losses, t.ties);
  const seedOf = new Map(data.seeds.map((id, i) => [id, i + 1]));
  const divisionWinners = new Set(data.divisionWinners);
  // Once the week being played has kicked off, its games count at their live odds (the Live tab's)
  const liveOdds = data.live ?? null;
  const shownOdds = liveOdds?.odds ?? data.odds;
  const gameOdds = liveOdds?.gameOdds ?? data.gameOdds;
  const odds = shownOdds?.teams ?? {};
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
      // How often winning out gets it in, from the simulated seasons where it does ("almost certainly" once
      // it would round to 100%, since only a clinch is certain)
      const winOut = o?.ifWinOut ?? null;
      const often = winOut === null ? null : winOut >= 0.995 ? 'they’re almost certainly in' : `they get in ${pct(winOut)} of the time`;
      if (sc.winOutAndIn) lines.push({ tone: 'good', text: 'Win out and they’re in.' });
      else if (sc.winOutPointsAtWorst) {
        // Only a tie on record can keep it out, and ties go to points for: where it stands on points
        const ties = sc.winOutTies;
        const pf = (rid: number) => data.teams.find((t) => t.rosterId === rid)?.pointsFor ?? 0;
        const behind = (ties ?? []).filter((rid) => pf(rid) >= pf(id)).length;
        const onPoints = !ties?.length
          ? 'a tie on record would go to points for'
          : behind === 0
            ? `they lead ${ties.length === 1 ? 'the one team' : `all ${ties.length} teams`} they could tie on record in points for`
            : behind === ties.length
              ? `they trail ${ties.length === 1 ? 'the one team' : `all ${ties.length} teams`} they could tie on record in points for`
              : `they trail ${behind} of the ${ties.length} teams they could tie on record in points for`;
        lines.push({
          // Grey however likely: green is for certainties (clinched, or in after winning out whatever else happens)
          tone: 'neutral',
          text: `Win out and ${often ?? 'only a tie on record can keep them out'}: ${onPoints}.`,
        });
      }
      if (!sc.winOutAndIn && sc.helpNeeded.length) {
        const help = sc.helpNeeded
          .slice(0, 3)
          .map((h) => `${name(h.winner)} beating ${name(h.loser)} (week ${h.week})`)
          .join(', or ');
        lines.push({
          tone: 'neutral',
          text:
            often && !sc.winOutPointsAtWorst
              ? `Win out and ${often}; they’re certainly in with any one of these too: ${help}.`
              : `Win out plus any one of these and they’re in for sure: ${help}.`,
        });
      } else if (!sc.winOutAndIn && !sc.winOutPointsAtWorst) {
        lines.push({ tone: 'bad', text: `Even winning out, they need help from several other results${often ? ` (${often})` : ''}.` });
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
      for (const g of shownOdds!.nextWeekGames) {
        if (g.a === id || g.b === id || g.settled) continue;
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
    const game = shownOdds!.nextWeekGames.find((g) => g.a === id || g.b === id);
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
          seed: side.seed ?? null,
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
  const oddsRows = sortRows(ranked, sort.state, (t, key) => {
    const o = odds[t.rosterId];
    switch (key) {
      case 'record': return recordValue(t.wins, t.losses, t.ties);
      case 'seed': return seedOf.get(t.rosterId);
      case 'playoffs': return o?.playoffs;
      case 'division': return o?.division;
      case 'bye': return o?.bye;
      case 'title': return o?.champion;
      case 'toilet': return o?.lastPlace;
      default: {
        // How much this week's game swings the selected odds
        const w = o?.ifWin?.[swingOutcome];
        const l = o?.ifLoss?.[swingOutcome];
        return w != null && l != null ? Math.abs(w - l) : null;
      }
    }
  });

  return (
    <div className="space-y-8">
      {shownOdds && (
        <SectionCard
          title="Playoff Odds"
          subtitle={`${shownOdds.sims.toLocaleString()} simulations of the remaining ${weeksLeft} week${weeksLeft === 1 ? '' : 's'} on the real schedule${
            liveOdds ? ` · week ${liveOdds.week} at live odds, as of ${new Date(liveOdds.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''
          }`}
          gradientType="info"
          footer={
            <span>
              Each simulated week, a team scores around its expected strength: the league&apos;s average so far, plus a
              weight on how far its best projected lineup sits from the league&apos;s (each player worth half his projection for
              that week and half his points per game this season) and a weight on how far its points per game sit from the
              league&apos;s. Both weights were fitted for each week of the season on 4,486 other 12-team leagues (2018–2025).
              Each simulated season also shifts each team by a random amount for how far off that estimate could be, held all
              season, on top of this season&apos;s week-to-week spread. Tested on those leagues, the odds were well calibrated
              (teams given 30% made the playoffs 31% of the time, 50% made it 50%, 88% made it 87%) and beat the earlier model
              at every week of the season. Bye and title odds are rougher: a single game swings them. The win/loss column shows
              the selected odds after a win or a loss this week.
              {liveOdds && (
                <> Week {liveOdds.week} has kicked off, so its games count at the Live tab&apos;s odds: points so far plus what each
                  side&apos;s players still to play are expected to add (as of {new Date(liveOdds.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}).</>
              )}
              {hasTitle && (
                <> Title odds play out the playoff bracket (weeks {data.playoffWeekStart}–{data.playoffWeekStart + 2}, higher score
                  advances) with the same model.</>
              )}
              {hasToilet && (
                <> Toilet bowl odds play out the toilet bowl too (weeks {data.playoffWeekStart}–{data.playoffWeekStart + 2}) with the same
                  model.</>
              )}
              {(hasTitle || hasToilet) && (
                <> Tested on thousands of other leagues&apos; real brackets, these beat the earlier model and a coin flip, but a
                  title mostly comes down to a few single games, so they move a lot.</>
              )}{' '}
              <AccuracyLink />
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
          <ColumnChips picker={cols} />
          <SortStatus sort={sort} />
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--border)]">
              <thead className="bg-[var(--surface)]">
                <tr>
                  <th className={`${PIN_TH} py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider bg-[var(--surface)]`}>Team</th>
                  <SortableTh sort={sort} col="record" className={`${cols.col('record')} px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider`}>Record</SortableTh>
                  <SortableTh sort={sort} col="seed" best="asc" label="Current seed" className={`${cols.col('seed')} px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider`}>Now</SortableTh>
                  <SortableTh sort={sort} col="playoffs" best="desc" label="Playoff odds" className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Playoffs</SortableTh>
                  {data.format.hasDivisions && (
                    <SortableTh sort={sort} col="division" best="desc" label="Division odds" className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Division</SortableTh>
                  )}
                  <SortableTh sort={sort} col="bye" tip="Chance of a first-round playoff bye. *Rougher than the other odds: overconfident in backtests" best="desc" label="Playoff bye odds" className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Playoff bye*</SortableTh>
                  {hasTitle && (
                    <SortableTh sort={sort} col="title" best="desc" label="Title odds" className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Title</SortableTh>
                  )}
                  {hasToilet && (
                    <SortableTh sort={sort} col="toilet" tip="Chance of losing the toilet bowl (the losers’ bracket final)" best="asc" label="Toilet bowl odds" className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Lose toilet bowl</SortableTh>
                  )}
                  <SortableTh
                    sort={sort}
                    col="swing"
                    label={`Week ${nextWeek} swing`}
                    tip={`Odds with a win / with a loss this week. Sorts by the gap between them (±, in points): how much is riding on week ${nextWeek}`}
                    tipAlign="right"
                    className="px-3 py-3 text-center text-xs font-medium text-[var(--muted)] uppercase tracking-wider"
                  >
                    <span className="flex flex-col">
                      Week {nextWeek}: win / loss
                      <span className="normal-case tracking-normal">{swingLabel}</span>
                    </span>
                  </SortableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {oddsRows.map((t) => {
                  const o = odds[t.rosterId];
                  const seed = seedOf.get(t.rosterId);
                  const st = status(t.rosterId);
                  return (
                    <tr key={t.rosterId} className={mineRow(t.rosterId === me.rosterId)}>
                      <td className={`${PIN_TD} py-2 whitespace-nowrap bg-[var(--surface-elevated)]`}>
                        <TeamName
                          name={name(t.rosterId)}
                          sub={`@${user(t.rosterId)}`}
                          after={st && <span className="text-xs font-medium" style={{ color: TONE_COLOR[st.tone] }}>{st.label}</span>}
                        />
                      </td>
                      <td className={`${cols.col('record')} px-3 py-2 whitespace-nowrap text-center text-sm text-[var(--foreground)]`}>
                        {record(t)}
                        <div className="text-xs text-[var(--muted)]">{t.pointsFor.toFixed(1)} pts</div>
                      </td>
                      <td className={`${cols.col('seed')} px-3 py-2 whitespace-nowrap text-center text-sm text-[var(--foreground)]`}>
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
                            <span className="ml-1.5 text-xs text-[var(--muted)]">±{Math.abs(pointsChange(o.ifLoss[swingOutcome]!, o.ifWin[swingOutcome]!))}</span>
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
        {(() => {
          // Your team (or the top team) in full; every other team a row that opens to the same card
          const featured = ranked.find((t) => t.rosterId === me.rosterId) ?? ranked[0];
          const card = (t: OddsTeam) => {
            const lines = linesFor(t.rosterId);
            return (
              <>
                <ul className="space-y-1.5">
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
              </>
            );
          };
          const header = (t: OddsTeam) => (
            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
              <div className="min-w-0">{teamLabel(t.rosterId)}</div>
              <div className="shrink-0 text-right text-sm">
                <div className="font-semibold text-[var(--foreground)]">{record(t)}</div>
                {odds[t.rosterId] && <div className="text-xs text-[var(--muted)]">{pct(odds[t.rosterId].playoffs)} playoffs</div>}
              </div>
            </div>
          );
          return (
            <div className="space-y-3 p-4 sm:p-6">
              {featured && (
                <div className="rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-4">
                  {header(featured)}
                  <div className="mt-3">{card(featured)}</div>
                </div>
              )}
              <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                {ranked
                  .filter((t) => t !== featured)
                  .map((t) => {
                    const top = linesFor(t.rosterId)[0];
                    return (
                      <li key={t.rosterId}>
                        <details className="group">
                          <summary className="flex cursor-pointer list-none items-start gap-2 px-4 py-3 hover:bg-[var(--hover)] [&::-webkit-details-marker]:hidden">
                            <span aria-hidden className="mt-0.5 inline-block text-[var(--muted)] transition-transform group-open:rotate-90">›</span>
                            <div className="min-w-0 flex-1">
                              {header(t)}
                              {top && (
                                <div className="mt-1 flex gap-2 text-xs text-[var(--muted)] group-open:hidden">
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TONE_COLOR[top.tone] }} />
                                  <span className="line-clamp-1">{top.text}</span>
                                </div>
                              )}
                            </div>
                          </summary>
                          <div className="px-4 pb-4 pl-9">{card(t)}</div>
                        </details>
                      </li>
                    );
                  })}
              </ul>
            </div>
          );
        })()}
      </SectionCard>

      {gameOdds && <GamesAhead gameOdds={gameOdds} liveWeek={liveOdds?.week ?? null} teams={data.teams} teamStats={teamStats} />}

      <WhatIf data={data} teamStats={teamStats} />

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

      <OddsHistoryChart season={data.season} teamStats={teamStats} liveOdds={data.odds} lastScoredWeek={data.lastScoredWeek} />
    </div>
  );
}
