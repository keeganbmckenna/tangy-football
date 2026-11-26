'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import LiveTab from '@/components/LiveTab';
import { useMatchupLineups } from '@/components/useMatchupLineups';
import { OddsBar, SideName, SideScore } from '@/components/ui/MatchupSides';
import { usePlayoffOdds } from '@/hooks/useOddsData';
import { getTeamName } from '@/lib/analyze/teamIdentity';
import { myMatchupFirst } from '@/lib/analyze/myMatchup';
import ShareButton from '@/components/ui/ShareButton';
import { teamAvatarUrl } from '@/lib/analyze/teamIdentity';
import { myWeekMatchupFirst } from '@/lib/analyze/myMatchup';
import { useMyTeam } from '@/hooks/useMyTeam';
import { useSeasonInsights } from '@/hooks/useSeasonInsights';
import { weekAwards } from '@/lib/analyze/awards';
import { LeagueData, WeekMatchup } from '@/lib/types';

interface WeeklyMatchupsProps {
  matchups: Record<number, WeekMatchup[]>;
  lastScoredWeek?: number;
  /** For each matchup's lineups (tap a matchup) */
  leagueData?: LeagueData | null;
  /** The week being played, shown live (the Live tab's matchups and lineups) and picked first */
  live?: { week: number; regularSeasonEnd: number; playoffTeams: number; hasDivisions: boolean } | null;
  /** A share link's week, and the matchup to open in it */
  linkTarget?: { week: number; matchup: number | null } | null;
}

export default function WeeklyMatchups({ matchups, lastScoredWeek, leagueData, live, linkTarget }: WeeklyMatchupsProps) {
  const weeks = Object.keys(matchups)
    .map(Number)
    // Only show completed weeks: the current unscored week's matchups are 0-0 "ties"
    .filter((week) => lastScoredWeek === undefined || week <= lastScoredWeek)
    .sort((a, b) => a - b); // Sort ascending (1, 2, 3, ...)
  // The week being played first, otherwise the most recent completed week
  const [selectedWeek, setSelectedWeek] = useState(live?.week ?? (weeks[weeks.length - 1] || 1));
  const showLive = !!live && selectedWeek === live.week && !!leagueData;

  // The weeks still to come (after the one being played): each game with the model's win odds and projections
  const { data: odds } = usePlayoffOdds(!!leagueData);
  const upcoming = useMemo(() => {
    const after = live?.week ?? lastScoredWeek ?? 0;
    const byWeek = new Map<number, Array<{ a: number; b: number; aWins: number }>>();
    for (const g of odds?.gameOdds ?? []) if (g.week > after) byWeek.set(g.week, [...(byWeek.get(g.week) ?? []), g]);
    return byWeek;
  }, [odds, live?.week, lastScoredWeek]);
  const futureWeeks = [...upcoming.keys()].sort((a, b) => a - b);
  const future = upcoming.get(selectedWeek) ?? null;

  // My matchup first, with me on the left
  const me = useMyTeam();
  const currentMatchups = myWeekMatchupFirst(matchups[selectedWeek] || [], me.rosterId);

  // The week's awards; the lineup and projection ones once the season's insights load
  const { data: insights } = useSeasonInsights(leagueData?.league.season, leagueData?.league.status === 'complete');
  const awards = useMemo(() => {
    const teamWeeks = insights
      ? new Map(Object.entries(insights.teams).flatMap(([rid, list]) => list.filter((w) => w.week === selectedWeek).map((w) => [Number(rid), w] as const)))
      : undefined;
    return weekAwards(matchups[selectedWeek] ?? [], teamWeeks);
  }, [matchups, selectedWeek, insights]);

  // Tap a matchup for both lineups
  const lineups = useMatchupLineups(leagueData);
  const game = (m: WeekMatchup) => ({
    week: m.week,
    matchupId: m.matchupId,
    a: { rosterId: m.team1.rosterId, name: m.team1.name, points: m.team1.points },
    b: { rosterId: m.team2.rosterId, name: m.team2.name, points: m.team2.points },
  });

  // A share link: its week, with its matchup open (the live lineups for the week being played)
  const [liveLink, setLiveLink] = useState<number | null>(null);
  const linked = useRef(false);
  const sectionRef = useRef<HTMLDivElement | null>(null);
  // Phones: the week buttons are one row that scrolls sideways, kept centered on the week shown
  const weekRow = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const row = weekRow.current;
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !on || row.scrollWidth <= row.clientWidth) return;
    // Only the row scrolls, never the page
    row.scrollLeft = on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2;
  }, [selectedWeek]);
  useEffect(() => {
    if (linked.current || !linkTarget || !leagueData) return;
    const isLive = live?.week === linkTarget.week;
    if (!isLive && !weeks.includes(linkTarget.week)) return;
    linked.current = true;
    setSelectedWeek(linkTarget.week);
    // Bring the section into view once the cards above it have drawn (they'd push it down after)
    window.setTimeout(() => sectionRef.current?.scrollIntoView({ block: 'start' }), 400);
    if (linkTarget.matchup === null) return;
    if (isLive) setLiveLink(linkTarget.matchup);
    else {
      const m = (matchups[linkTarget.week] ?? []).find((x) => x.matchupId === linkTarget.matchup);
      if (m) lineups.openLineups(game(m));
    }
    // Once (linked): later renders that change these don't reopen it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkTarget, leagueData, live?.week, weeks.length, matchups]);

  return (
    <div ref={sectionRef} className="section-card scroll-mt-4 bg-[var(--surface-elevated)] rounded-lg shadow-lg overflow-hidden border border-[var(--border)]">
      <div className="section-header bg-gradient-to-r from-green-600 to-green-800 px-4 py-3 sm:px-6 sm:py-4" data-tone="green">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-white sm:text-2xl">Weekly Matchups</h2>
          {leagueData && !future && (
            <ShareButton
              path={`/?season=${leagueData.league.season}&week=${selectedWeek}`}
              title={`Week ${selectedWeek} ${showLive ? 'so far' : 'recap'}`}
              label="Share week"
              className="bg-white/15 text-white hover:bg-white/25"
            />
          )}
        </div>
        <div ref={weekRow} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 sm:flex-wrap sm:overflow-visible">
          {weeks.map((week) => (
            <button
              key={week}
              onClick={() => setSelectedWeek(week)}
              aria-pressed={selectedWeek === week}
              className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                selectedWeek === week
                  ? 'bg-[var(--surface-elevated)] text-[var(--foreground)]'
                  : 'bg-white/15 text-white hover:bg-white/25'
              }`}
            >
              W{week}
            </button>
          ))}
          {live && (
            <button
              onClick={() => setSelectedWeek(live.week)}
              aria-label={`Week ${live.week}, live`}
              aria-pressed={selectedWeek === live.week}
              className={`flex shrink-0 items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                selectedWeek === live.week
                  ? 'bg-[var(--surface-elevated)] text-[var(--foreground)]'
                  : 'bg-white/15 text-white hover:bg-white/25'
              }`}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red-500" />
              W{live.week}
            </button>
          )}
          {futureWeeks.map((week) => (
            <button
              key={week}
              onClick={() => setSelectedWeek(week)}
              aria-label={`Week ${week}, to come`}
              aria-pressed={selectedWeek === week}
              className={`shrink-0 rounded-md border border-dashed px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedWeek === week
                  ? 'border-transparent bg-[var(--surface-elevated)] text-[var(--foreground)]'
                  : 'border-white/40 text-white hover:bg-white/15'
              }`}
            >
              W{week}
            </button>
          ))}
        </div>
      </div>
      {showLive && leagueData && live && (
        <LiveTab compact initialMatchup={liveLink} leagueData={leagueData} regularSeasonEnd={live.regularSeasonEnd} playoffTeams={live.playoffTeams} hasDivisions={live.hasDivisions} />
      )}
      {future && leagueData && (
        <>
          <p className="px-4 pt-3 text-xs text-[var(--muted)] sm:px-6">
            Projected from today’s rosters and projections, with the playoff model’s odds for each game. They’ll move with injuries, byes and roster moves.
          </p>
          <div className="grid grid-cols-1 gap-3 p-4 sm:gap-4 sm:p-6 md:grid-cols-2">
            {myMatchupFirst(future, (g) => (me.rosterId === null ? null : g.a === me.rosterId ? 'left' : g.b === me.rosterId ? 'right' : null), (g) => ({ a: g.b, b: g.a, aWins: 1 - g.aWins })).map((g) => {
              const name = (id: number) => getTeamName(id, leagueData).name;
              const proj = (id: number) => odds?.gamePoints?.[selectedWeek]?.[id];
              const sub = (id: number) => (proj(id) === undefined ? undefined : `proj ${proj(id)!.toFixed(1)}`);
              const dash = <span className="text-[var(--muted)]">–</span>;
              return (
                <div key={`${g.a}-${g.b}`} className={`rounded-lg border px-3 py-2.5 ${g.a === me.rosterId ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                    <SideScore name={name(g.a)} avatarUrl={teamAvatarUrl(leagueData, g.a)} align="left" score={dash} sub={sub(g.a)} />
                    <span className="text-[10px] font-semibold uppercase text-[var(--muted)]">vs</span>
                    <SideScore name={name(g.b)} avatarUrl={teamAvatarUrl(leagueData, g.b)} align="right" score={dash} sub={sub(g.b)} />
                  </div>
                  <OddsBar a={g.aWins} />
                  <div className="mt-1.5 flex gap-3">
                    <SideName name={name(g.a)} username={getTeamName(g.a, leagueData).username} align="left" />
                    <SideName name={name(g.b)} username={getTeamName(g.b, leagueData).username} align="right" />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {!showLive && !future && awards.length > 0 && (
        <div className="border-b border-[var(--border)] py-3">
          {/* One row that scrolls sideways on phones, wrapping on wider screens */}
          <ul className="flex gap-2 overflow-x-auto px-4 sm:flex-wrap sm:px-6" aria-label={`Week ${selectedWeek} awards`}>
            {awards.map((a) => (
              <li
                key={a.id}
                className={`w-44 shrink-0 rounded-lg border px-3 py-2 sm:w-auto sm:max-w-[16rem] ${a.rosterId === me.rosterId ? 'border-[var(--accent)]' : 'border-[var(--border)]'} bg-[var(--surface)]`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{a.label}</div>
                <div className="truncate text-sm font-medium text-[var(--foreground)]" title={a.who}>{a.who}</div>
                <div className="text-xs tabular-nums text-[var(--muted)]">{a.detail}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!showLive && !future && <div className="grid grid-cols-1 gap-3 p-4 sm:gap-4 sm:p-6 md:grid-cols-2">
        {currentMatchups.length === 0 ? (
          <p className="col-span-full text-center text-[var(--muted)] py-8">
            No matchups available for this week
          </p>
        ) : (
          currentMatchups.map((matchup) => (
            <button
              type="button"
              key={matchup.matchupId}
              onClick={() => lineups.openLineups(game(matchup))}
              disabled={!leagueData}
              aria-label={`${matchup.team1.name} vs ${matchup.team2.name}: see lineups`}
              className={`block w-full rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-[var(--hover)] disabled:hover:bg-transparent ${matchup.team1.rosterId === me.rosterId ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <SideScore name={matchup.team1.name} avatarUrl={teamAvatarUrl(leagueData, matchup.team1.rosterId)} align="left" score={matchup.team1.points.toFixed(2)} faded={matchup.winner === 'team2'} />
                {/* The result in the middle: who won is the trophy and the faded score, so just the margin here */}
                <div className="text-center text-[10px] font-semibold uppercase leading-tight text-[var(--muted)]">
                  {lineups.isLoading(game(matchup)) ? (
                    'loading'
                  ) : matchup.winner === 'tie' ? (
                    'tie'
                  ) : matchup.winner ? (
                    <>
                      final
                      <div className="font-medium normal-case tabular-nums">by {Math.abs(matchup.team1.points - matchup.team2.points).toFixed(2)}</div>
                    </>
                  ) : (
                    'vs'
                  )}
                </div>
                <SideScore name={matchup.team2.name} avatarUrl={teamAvatarUrl(leagueData, matchup.team2.rosterId)} align="right" score={matchup.team2.points.toFixed(2)} faded={matchup.winner === 'team1'} />
              </div>
              <div className="mt-1.5 flex gap-3">
                <SideName name={matchup.team1.name} username={matchup.team1.username} align="left" won={matchup.winner === 'team1'} />
                <SideName name={matchup.team2.name} username={matchup.team2.username} align="right" won={matchup.winner === 'team2'} />
              </div>
            </button>
          ))
        )}
      </div>}
      {lineups.dialog}
    </div>
  );
}
