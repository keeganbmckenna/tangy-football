'use client';

import { useCallback, useEffect, useState } from 'react';
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

import LoadingSpinner from '@/components/ui/LoadingSpinner';
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

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leagueData, setLeagueData] = useState<LeagueData | null>(null);
  const [teamStats, setTeamStats] = useState<TeamStats[]>([]);
  const [matchups, setMatchups] = useState<Record<number, WeekMatchup[]>>({});
  const [activeTab, setActiveTab] = useState('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [availableSeasons, setAvailableSeasons] = useState<string[]>([]);

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
  const regularSeasonWeekCap = leagueData && leagueSettings
    ? Math.min(leagueData.lastScoredWeek, leagueSettings.regularSeasonEnd)
    : undefined;

  const fetchData = useCallback(async (season?: string) => {
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
      setSelectedSeason(season ?? data.league.season);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setLoading(false);
    }
  }, []);

  const handleSeasonChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const season = event.target.value;
    setSelectedSeason(season);
    fetchData(season);
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <LoadingSpinner message="Loading league data..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="bg-[var(--surface-elevated)] border border-[var(--danger-text)]/40 rounded-lg p-8 max-w-md">
          <h2 className="text-[var(--danger-text)] text-xl font-bold mb-2">Error</h2>
          <p className="text-[var(--muted)]">{error}</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', name: 'Overview', icon: '📊' },
    { id: 'draft', name: 'Draft', icon: '📋' },
    { id: 'postseason', name: 'Postseason', icon: '🏆' },
    { id: 'weekly', name: 'Weekly Performance', icon: '📈' },
    { id: 'trends', name: 'Season Trends', icon: '📉' },
    { id: 'advanced', name: 'Advanced Stats', icon: '🔬' },
  ];

  const seasonOptions = availableSeasons.length
    ? availableSeasons
    : leagueData?.league?.season
      ? [leagueData.league.season]
      : [];

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* Header */}
      <header className="bg-[var(--surface-elevated)] shadow-md border-b border-[var(--border)]">
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="absolute right-4 top-4 sm:right-6 sm:top-6 lg:right-8 lg:top-6">
            <ThemeToggle />
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-4">
              {leagueData?.league?.avatar && (
                <Image
                  src={`https://sleepercdn.com/avatars/${leagueData.league.avatar}`}
                  alt="League Avatar"
                  width={64}
                  height={64}
                  className="rounded-full"
                />
              )}
              <h1 className="text-4xl font-bold text-[var(--foreground)]">
                {leagueData?.league?.name || 'Fantasy Football'}
              </h1>
            </div>
            <div className="mt-2 flex items-center justify-center gap-3 text-lg text-[var(--muted)]">
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
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[var(--border)]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Desktop Navigation */}
            <nav className="-mb-px hidden md:flex space-x-8" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`${
                    activeTab === tab.id
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--border)]'
                  } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors`}
                >
                  <span className="mr-2">{tab.icon}</span>
                  {tab.name}
                </button>
              ))}
            </nav>

            {/* Mobile Navigation */}
            <div className="md:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="flex items-center justify-between w-full py-4 text-left"
                aria-expanded={mobileMenuOpen}
              >
                <span className="text-sm font-medium text-[var(--foreground)]">
                  <span className="mr-2">{tabs.find(t => t.id === activeTab)?.icon}</span>
                  {tabs.find(t => t.id === activeTab)?.name}
                </span>
                <svg
                  className={`h-5 w-5 text-[var(--muted)] transition-transform ${mobileMenuOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <title>Toggle menu</title>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {mobileMenuOpen && (
                <div className="pb-3 space-y-1">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`${
                        activeTab === tab.id
                          ? 'bg-[var(--surface)] text-[var(--accent)]'
                          : 'text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]'
                      } block w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors`}
                    >
                      <span className="mr-2">{tab.icon}</span>
                      {tab.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <>
            <ErrorBoundary>
              <section>
                <PlayoffRace
                  divisions={divisions}
                  wildCard={wildCard}
                  standings={teamStats}
                  playoffTeams={leagueSettings?.playoffTeams ?? teamStats.length}
                />
              </section>
            </ErrorBoundary>
            <ErrorBoundary>
              <section>
                <WeeklyMatchups matchups={matchups} lastScoredWeek={leagueData?.lastScoredWeek} />
              </section>
            </ErrorBoundary>
          </>
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
            <ErrorBoundary>
              <section>
                <PlayoffBracket brackets={postseasonBrackets} />
              </section>
            </ErrorBoundary>
            {leagueSettings?.hasToiletBowl && (
              <ErrorBoundary>
                <section>
                  <ToiletBowlBracket brackets={postseasonBrackets} />
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

      </main>

      {/* Footer */}
      <footer className="bg-[var(--surface-elevated)] border-t border-[var(--border)] mt-12">
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
