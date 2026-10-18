'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ChangeEvent } from 'react';
import Image from 'next/image';
import PlayoffRace from '@/components/PlayoffRace';
import WeeklyScores from '@/components/WeeklyScores';
import WeeklyMatchups from '@/components/WeeklyMatchups';
import PlayoffBracket from '@/components/PlayoffBracket';
import ToiletBowlBracket from '@/components/ToiletBowlBracket';
import StandingsOverTime from '@/components/StandingsOverTime';
import CumulativeScores from '@/components/CumulativeScores';
import PointsVsMedian from '@/components/PointsVsMedian';
import WeeklyRankingsHeatmap from '@/components/WeeklyRankingsHeatmap';
import PlayEveryoneAnalysis from '@/components/PlayEveryoneAnalysis';
import ScheduleLuckDistribution from '@/components/ScheduleLuckDistribution';
import WeeklyPlayAll from '@/components/WeeklyPlayAll';
import DraftBoard from '@/components/DraftBoard';
import LiveTab from '@/components/LiveTab';
import TradesTab from '@/components/TradesTab';
import HistoryTab from '@/components/HistoryTab';
import LegacySeasonOverview from '@/components/LegacySeasonOverview';
import { LEGACY_SEASONS, MANAGER_FIRST_NAMES } from '@/lib/data/legacyHistory';
import { readUrlState, urlSearchFor } from '@/lib/urlState';
import { resetTableSorts } from '@/hooks/useTableSort';
import { MyTeamContext, readMyTeam, saveMyTeam } from '@/hooks/useMyTeam';
import PlayoffPicture from '@/components/PlayoffPicture';

import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { FootballSpinner } from '@/components/ui/Football';
import Chalkboard from '@/components/ui/Chalkboard';
import HomeLink from '@/components/ui/HomeLink';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import ThemeToggle from '@/components/ui/ThemeToggle';
import { LeagueData, TeamStats, WeekMatchup, PlayEveryoneStats, WeeklyPlayAllStats, DivisionStanding, WildCardStanding, ScheduleLuckSimulation } from '@/lib/types';
import type { PostseasonBrackets } from '@/lib/analyze/brackets';
import {
  calculateTeamStats,
  getWeeklyMatchups,
  calculateStandingsOverTime,
  calculateCumulativeScores,
  calculateDifferenceFromMedian,
  calculateWeeklyRankings,
  calculatePlayEveryoneStats,
  calculateWeeklyPlayAll,
  calculateDivisionStandings,
  calculateWildCardStandings,
  simulateScheduleLuck,
  buildPostseasonBrackets,
} from '@/lib/analyze';
import { getLeagueSettings } from '@/lib/leagueSettings';
import { getTeamName } from '@/lib/analyze/teamIdentity';

/** View Transitions, except in Safari (and so every iPhone browser), where they flicker */
function canViewTransition() {
  const ua = navigator.userAgent;
  const safari = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  return 'startViewTransition' in document && !safari;
}

/** Which weeks the season's numbers cover */
function DataThrough({ leagueData, regularSeasonEnd }: { leagueData: LeagueData; regularSeasonEnd: number }) {
  const week = leagueData.lastScoredWeek;
  const text =
    leagueData.league.status === 'complete'
      ? 'Final: the season is complete'
      : week === 0
        ? 'No games played yet'
        : week >= regularSeasonEnd
          ? `Regular season complete (${regularSeasonEnd} weeks); playoffs in progress`
          : `Stats through week ${week} of ${regularSeasonEnd} (completed weeks only; see Live for this week)`;
  return <p className="text-sm text-[var(--muted)]">{text}</p>;
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leagueData, setLeagueData] = useState<LeagueData | null>(null);
  const [teamStats, setTeamStats] = useState<TeamStats[]>([]);
  const [matchups, setMatchups] = useState<Record<number, WeekMatchup[]>>({});
  const [activeTab, setActiveTab] = useState('overview');
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [availableSeasons, setAvailableSeasons] = useState<string[]>([]);
  // Where View Transitions aren't used, the new tab fades in instead (set after mount)
  const [fadeTabs, setFadeTabs] = useState(false);

  // Calculated data
  const [standingsOverTime, setStandingsOverTime] = useState<Record<string, number[]>>({});
  const [cumulativeScores, setCumulativeScores] = useState<Record<string, number[]>>({});
  const [differenceFromMedian, setDifferenceFromMedian] = useState<Record<string, number[]>>({});
  const [weeklyRankings, setWeeklyRankings] = useState<Record<string, number[]>>({});
  const [playEveryoneData, setPlayEveryoneData] = useState<PlayEveryoneStats[]>([]);
  const [weeklyPlayAllData, setWeeklyPlayAllData] = useState<WeeklyPlayAllStats[]>([]);
  const [scheduleLuckSimulation, setScheduleLuckSimulation] = useState<ScheduleLuckSimulation | null>(null);
  const [divisions, setDivisions] = useState<DivisionStanding[]>([]);
  const [wildCard, setWildCard] = useState<WildCardStanding[]>([]);
  const [postseasonBrackets, setPostseasonBrackets] = useState<PostseasonBrackets | null>(null);

  const leagueSettings = leagueData ? getLeagueSettings(leagueData.league) : null;
  // Seasons before Sleeper only have final standings (lib/data/legacyHistory.ts)
  const legacySeasons = LEGACY_SEASONS.map((s) => s.season);
  const isLegacySeason = legacySeasons.includes(selectedSeason);
  // Current season's regular season still being played: the Playoffs tab
  // shows the playoff picture instead of empty brackets
  // The newest season is the current one; Live only applies to it
  const isCurrentSeason = availableSeasons.length === 0
    || (selectedSeason || leagueData?.league.season) === availableSeasons[0];
  const regularSeasonInProgress = !!leagueData && !!leagueSettings
    && leagueData.league.season === availableSeasons[0]
    && leagueData.league.status !== 'complete'
    && leagueData.lastScoredWeek < leagueSettings.regularSeasonEnd;
  // Trade and waiver tools only apply once the current season's rosters are
  // set and until its regular season ends; past trades are under History
  const showTradesTab = regularSeasonInProgress && leagueData?.league.status === 'in_season';
  const regularSeasonWeekCap = leagueData && leagueSettings
    ? Math.min(leagueData.lastScoredWeek, leagueSettings.regularSeasonEnd)
    : undefined;

  // `show` is the season to display, when it isn't the one fetched (seasons before Sleeper)
  const fetchData = useCallback(async (season?: string, show?: string): Promise<boolean> => {
    try {
      setLoading(true);
      setError(null);
      const query = season ? `?season=${season}` : '';
      const response = await fetch(`/api/league${query}`);
      if (!response.ok) {
        throw new Error('Failed to fetch league data');
      }
      const data: LeagueData = await response.json();
      setLeagueData(data);
      setAvailableSeasons(data.availableSeasons || []);
      setSelectedSeason(show ?? data.league.season);

      // Calculate stats (pass lastScoredWeek to limit performance metrics to completed weeks)
      const stats = calculateTeamStats(data, data.lastScoredWeek);
      setTeamStats(stats);

      const leagueSettings = getLeagueSettings(data.league);
      const regularSeasonWeekCap = Math.min(
        data.lastScoredWeek,
        leagueSettings.regularSeasonEnd
      );

      // Get matchups
      const weeklyMatchups = getWeeklyMatchups(data);
      setMatchups(weeklyMatchups);

      const postseason = buildPostseasonBrackets(data, leagueSettings);
      setPostseasonBrackets(postseason);

      // Calculate additional analytics
      // Only count completed regular-season weeks for weekly analytics
      setStandingsOverTime(calculateStandingsOverTime(stats, regularSeasonWeekCap));
      setCumulativeScores(calculateCumulativeScores(stats, regularSeasonWeekCap));
      setDifferenceFromMedian(calculateDifferenceFromMedian(stats, regularSeasonWeekCap));
      setWeeklyRankings(calculateWeeklyRankings(stats, regularSeasonWeekCap));
      setPlayEveryoneData(calculatePlayEveryoneStats(stats, regularSeasonWeekCap));
      setWeeklyPlayAllData(calculateWeeklyPlayAll(stats, regularSeasonWeekCap));
      setScheduleLuckSimulation(simulateScheduleLuck(stats, 20000, regularSeasonWeekCap));

      // Calculate division standings and wild card race
      const hasDivisions = leagueSettings.divisions > 0;
      const divisionStandings = hasDivisions ? calculateDivisionStandings(stats) : [];
      setDivisions(divisionStandings);

      const wildCardSpots = hasDivisions
        ? Math.max(leagueSettings.playoffTeams - leagueSettings.divisions, 0)
        : 0;
      const wildCardStandings = wildCardSpots > 0
        ? calculateWildCardStandings(stats, leagueSettings.playoffTeams)
        : [];
      setWildCard(wildCardStandings);

      setLoading(false);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
      return false;
    }
  }, []);

  const changeSeason = useCallback(
    (season: string) => {
      if (season === (selectedSeason || leagueData?.league.season)) return;
      // A new season starts every table in its own order
      resetTableSorts();
      setSelectedSeason(season);
      // Seasons before Sleeper have nothing to fetch (tabs that don't apply fall back to Overview below)
      if (LEGACY_SEASONS.some((s) => s.season === season)) return;
      fetchData(season);
    },
    [selectedSeason, leagueData, fetchData]
  );

  const handleSeasonChange = (event: ChangeEvent<HTMLSelectElement>) => changeSeason(event.target.value);

  // First load: the view in the address bar, if any (an unknown season falls back to the current one)
  useEffect(() => {
    const { tab, season } = readUrlState(window.location.search);
    if (tab) setActiveTab(tab);
    setMyUserId(readMyTeam());
    setFadeTabs(!canViewTransition());
    (async () => {
      if (season && LEGACY_SEASONS.some((s) => s.season === season)) await fetchData(undefined, season);
      else if (!season || !(await fetchData(season))) await fetchData();
    })();
  }, [fetchData]);

  // Keep the address bar in step: a new history entry per change, so back/forward work
  // Tabs crossfade with View Transitions where they work well (and motion is welcome)
  const switchTab = (id: string) => {
    const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
    if (id === activeTab || !doc.startViewTransition || !canViewTransition() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setActiveTab(id);
      return;
    }
    doc.startViewTransition(() => flushSync(() => setActiveTab(id)));
  };

  // The logo and name: back to Overview for the current season, at the top
  const goHome = () => {
    switchTab('overview');
    const current = availableSeasons[0];
    if (current) changeSeason(current);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    // Only the tab row scrolls, never the page
    nav.scrollTo({ left: active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
  }, [activeTab]);

  const fromHistory = useRef(false);
  const urlSynced = useRef(false);
  useEffect(() => {
    if (!leagueData || loading) return;
    const current = availableSeasons[0] ?? leagueData.league.season;
    const search = urlSearchFor(activeTab, selectedSeason || leagueData.league.season, current);
    if (search !== window.location.search) {
      const url = `${window.location.pathname}${search}${window.location.hash}`;
      if (fromHistory.current || !urlSynced.current) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    }
    fromHistory.current = false;
    urlSynced.current = true;
  }, [activeTab, selectedSeason, leagueData, availableSeasons, loading]);

  useEffect(() => {
    const onPop = () => {
      const { tab, season } = readUrlState(window.location.search);
      fromHistory.current = true;
      setActiveTab(tab ?? 'overview');
      const target = season ?? availableSeasons[0];
      if (target) changeSeason(target);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [availableSeasons, changeSeason]);

  const tabs = [
    // Most-checked in season first; the draft is reference material, so last
    { id: 'overview', name: 'Overview', icon: '📊' },
    { id: 'live', name: 'Live', icon: '🔴' },
    { id: 'postseason', name: 'Playoffs', icon: '🏆' },
    { id: 'weekly', name: 'Weekly Performance', icon: '📈' },
    { id: 'trends', name: 'Season Trends', icon: '📉' },
    { id: 'advanced', name: 'Advanced Stats', icon: '🔬' },
    { id: 'draft', name: 'Draft', icon: '📋' },
    { id: 'trades', name: 'Trades & Waivers', icon: '🔄' },
    { id: 'history', name: 'History', icon: '🏛️' },
  ]
    .filter((tab) => tab.id !== 'live' || isCurrentSeason)
    .filter((tab) => tab.id !== 'trades' || showTradesTab)
    .filter((tab) => !isLegacySeason || tab.id === 'overview' || tab.id === 'history');
  const tabIds = tabs.map((t) => t.id).join();

  // A tab that doesn't apply to this season (a link, or a season switch) falls back to Overview
  useEffect(() => {
    if (leagueData && !loading && !tabIds.split(',').includes(activeTab)) setActiveTab('overview');
  }, [leagueData, loading, tabIds, activeTab]);

  // "You": the manager picked once on this device, and their roster in the season shown
  const managerOptions = useMemo(() => {
    if (!leagueData) return [];
    const firstNames = new Map(Object.entries(MANAGER_FIRST_NAMES).map(([k, v]) => [k.toLowerCase(), v]));
    return leagueData.rosters
      .filter((r) => r.owner_id)
      .map((r) => {
        const u = leagueData.userMap[r.owner_id];
        const name = u?.display_name || u?.username || 'Unknown';
        return { userId: r.owner_id, label: firstNames.get(name.toLowerCase()) ?? name };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [leagueData]);
  const myTeam = useMemo(() => {
    // Seasons before Sleeper have no rosters
    const rosterId = isLegacySeason ? null : leagueData?.rosters.find((r) => r.owner_id === myUserId)?.roster_id ?? null;
    return {
      userId: myUserId,
      rosterId,
      username: rosterId !== null && leagueData ? getTeamName(rosterId, leagueData).username : null,
      setUserId: (id: string | null) => {
        saveMyTeam(id);
        setMyUserId(id);
      },
    };
  }, [myUserId, leagueData, isLegacySeason]);

  if (loading && !leagueData) {
    return <LoadingSpinner message="Loading league data..." />;
  }

  if (error && !leagueData) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="bg-[var(--surface-elevated)] border border-[var(--danger-text)]/40 rounded-lg p-8 max-w-md">
          <h2 className="text-[var(--danger-text)] text-xl font-bold mb-2">Error</h2>
          <p className="text-[var(--muted)]">{error}</p>
          <button
            type="button"
            onClick={() => fetchData()}
            className="mt-4 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--hover)]"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const sleeperSeasons = availableSeasons.length
    ? availableSeasons
    : leagueData?.league?.season
      ? [leagueData.league.season]
      : [];
  const seasonOptions = [...sleeperSeasons, ...legacySeasons.filter((s) => !sleeperSeasons.includes(s))];

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Chalkboard />
      {/* Header */}
      <header className="site-header relative bg-[var(--surface-elevated)] shadow-md border-b border-[var(--border)] md:sticky md:top-0 z-40">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-2">
          <div className="absolute right-4 top-4 sm:right-6 lg:right-8">
            <ThemeToggle />
          </div>
          <div className="px-12 text-center sm:px-0">
            <HomeLink onHome={goHome}>
              {leagueData?.league?.avatar && (
                <Image
                  src={`https://sleepercdn.com/avatars/${leagueData.league.avatar}`}
                  alt=""
                  width={44}
                  height={44}
                  className="rounded-full"
                />
              )}
              <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">
                {leagueData?.league?.name || 'Fantasy Football'}
              </h1>
            </HomeLink>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-[var(--muted)] sm:text-base">
              <span>Season</span>
              <select
                value={selectedSeason || leagueData?.league?.season || ''}
                onChange={handleSeasonChange}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm text-[var(--foreground)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                {seasonOptions.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2">
                <span>You</span>
                <select
                  value={myUserId ?? ''}
                  onChange={(e) => myTeam.setUserId(e.target.value || null)}
                  title="Highlights your team everywhere and starts the trade and waiver tools on it. Saved on this device."
                  className="max-w-[10rem] rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--foreground)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                >
                  <option value="">Pick your team</option>
                  {managerOptions.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {/* Always takes its space, so picking a team doesn't shift the row */}
                <button
                  type="button"
                  onClick={() => myTeam.setUserId(null)}
                  aria-label="Clear your team"
                  title="Clear your team (stop highlighting it on this device)"
                  aria-hidden={!myUserId}
                  tabIndex={myUserId ? 0 : -1}
                  className={`-ml-1 flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)] ${myUserId ? '' : 'invisible'}`}
                >
                  ✕
                </button>
              </label>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--border)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Tabs: pills, centered; a row that scrolls sideways on phones */}
            <nav
              ref={navRef}
              className="flex overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Tabs"
            >
              <div className="tab-pills mx-auto flex gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] p-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => switchTab(tab.id)}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    className={`${
                      activeTab === tab.id
                        ? 'bg-[var(--info-bg)] text-[var(--info-text)] shadow-sm'
                        : 'text-[var(--muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)]'
                    } whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors lg:px-3.5`}
                  >
                    <span className="mr-1.5 sm:hidden lg:inline">{tab.icon}</span>
                    {tab.name}
                  </button>
                ))}
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <MyTeamContext.Provider value={myTeam}>
      <main className="relative z-[1] max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {loading ? (
          <div className="flex flex-col items-center py-24 text-[var(--muted)]">
            <FootballSpinner size="sm" />
            <p className="mt-4">Loading the {selectedSeason} season...</p>
          </div>
        ) : error ? (
          <div className="mx-auto max-w-md rounded-lg border border-[var(--danger-text)]/40 bg-[var(--surface-elevated)] p-6">
            <p className="text-[var(--muted)]">Couldn&apos;t load the {selectedSeason} season: {error}</p>
            <button
              type="button"
              onClick={() => fetchData(selectedSeason || undefined)}
              className="mt-4 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--hover)]"
            >
              Try again
            </button>
          </div>
        ) : (
        <div key={activeTab} className={fadeTabs ? 'tab-fade space-y-8' : 'space-y-8'}>
        {/* Overview Tab */}
        {activeTab === 'overview' && isLegacySeason && (
          <ErrorBoundary>
            <section>
              <LegacySeasonOverview season={selectedSeason} />
            </section>
          </ErrorBoundary>
        )}
        {activeTab === 'overview' && !isLegacySeason && (
          <>
            {leagueData && leagueSettings && <DataThrough leagueData={leagueData} regularSeasonEnd={leagueSettings.regularSeasonEnd} />}
            <ErrorBoundary>
              <section>
                <PlayoffRace
                  divisions={divisions}
                  wildCard={wildCard}
                  standings={teamStats}
                  playoffTeams={leagueSettings?.playoffTeams ?? teamStats.length}
                  divisionAvatars={leagueData?.divisionAvatars}
                />
              </section>
            </ErrorBoundary>
            <ErrorBoundary>
              <section>
                <WeeklyMatchups matchups={matchups} lastScoredWeek={leagueData?.lastScoredWeek} leagueData={leagueData} />
              </section>
            </ErrorBoundary>
          </>
        )}

        {/* Live Tab */}
        {activeTab === 'live' && isCurrentSeason && leagueData && leagueSettings && (
          <ErrorBoundary>
            <section>
              <LiveTab
                leagueData={leagueData}
                regularSeasonEnd={leagueSettings.regularSeasonEnd}
                playoffTeams={leagueSettings.playoffTeams}
                hasDivisions={leagueSettings.divisions > 0}
              />
            </section>
          </ErrorBoundary>
        )}

        {/* Draft Tab */}
        {activeTab === 'draft' && (selectedSeason || leagueData?.league?.season) && (
          <ErrorBoundary>
            <section>
              <DraftBoard
                season={selectedSeason || leagueData!.league.season}
                leagueData={leagueData}
              />
            </section>
          </ErrorBoundary>
        )}

        {/* Postseason Tab */}
        {activeTab === 'postseason' && (
          <>
            {regularSeasonInProgress ? (
              <ErrorBoundary>
                <section>
                  <PlayoffPicture teamStats={teamStats} />
                </section>
              </ErrorBoundary>
            ) : (
              <ErrorBoundary>
                <section>
                  <PlayoffBracket brackets={postseasonBrackets} leagueData={leagueData} />
                </section>
              </ErrorBoundary>
            )}
            {!regularSeasonInProgress && leagueSettings?.hasToiletBowl && (
              <ErrorBoundary>
                <section>
                  <ToiletBowlBracket brackets={postseasonBrackets} leagueData={leagueData} />
                </section>
              </ErrorBoundary>
            )}
          </>
        )}

        {/* Weekly Performance Tab */}
        {activeTab === 'weekly' && (
          <>
            <ErrorBoundary>
              <section>
                <WeeklyScores teams={teamStats} maxWeek={regularSeasonWeekCap} />
              </section>
            </ErrorBoundary>
            <ErrorBoundary>
              <section>
                <WeeklyRankingsHeatmap rankingsData={weeklyRankings} teams={teamStats} maxWeek={regularSeasonWeekCap} />
              </section>
            </ErrorBoundary>
          </>
        )}

        {/* Season Trends Tab */}
        {activeTab === 'trends' && (
          <>
            <ErrorBoundary>
              <section>
                <StandingsOverTime standingsData={standingsOverTime} teams={teamStats} maxWeek={regularSeasonWeekCap} />
              </section>
            </ErrorBoundary>
            <ErrorBoundary>
              <section>
                <CumulativeScores
                  cumulativeData={cumulativeScores}
                  teams={teamStats}
                  maxWeek={regularSeasonWeekCap}
                />
              </section>
            </ErrorBoundary>
            <ErrorBoundary>
              <section>
                <PointsVsMedian
                  differenceData={differenceFromMedian}
                  teams={teamStats}
                  maxWeek={regularSeasonWeekCap}
                />
              </section>
            </ErrorBoundary>
          </>
        )}

        {/* Advanced Stats Tab */}
        {activeTab === 'advanced' && (
          <>
            <ErrorBoundary>
              <section>
                <PlayEveryoneAnalysis data={playEveryoneData} />
              </section>
            </ErrorBoundary>
            <ErrorBoundary>
              <section>
                <ScheduleLuckDistribution data={scheduleLuckSimulation} />
              </section>
            </ErrorBoundary>
            <ErrorBoundary>
              <section>
                <WeeklyPlayAll data={weeklyPlayAllData} />
              </section>
            </ErrorBoundary>
          </>
        )}

        {/* History Tab: every season, whichever one is selected */}
        {activeTab === 'history' && (
          <ErrorBoundary>
            <section>
              <HistoryTab />
            </section>
          </ErrorBoundary>
        )}

        {/* Trades Tab */}
        {activeTab === 'trades' && showTradesTab && <TradesTab teamStats={teamStats} />}
        </div>
        )}
      </main>
      </MyTeamContext.Provider>

      {/* Footer */}
      <footer className="relative z-[1] bg-[var(--surface-elevated)] border-t border-[var(--border)] mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center text-[var(--muted)] text-sm">
          <p>
            Data from{' '}
            <a
              href="https://sleeper.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:opacity-80 underline"
            >
              Sleeper
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
