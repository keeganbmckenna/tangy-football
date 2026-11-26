'use client';

import Image from 'next/image';
import { useState } from 'react';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { TeamStats, DivisionStanding, WildCardStanding } from '@/lib/types';
import SectionCard from './ui/SectionCard';
import ResultDot from './ui/ResultDot';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import Term from './ui/Term';
import { ManagerLink } from '@/hooks/useManagerLink';
import { useColumnPicker, type ColumnPicker, type PickableColumn } from '@/hooks/useColumnPicker';
import ColumnChips from './ui/ColumnChips';
import { formatOdds } from '@/lib/analyze/playoffOdds';

/** Columns a phone can add to the division cards (wider screens show them from their own width) */
const ODDS_COLUMN: PickableColumn = { key: 'odds', label: 'Odds' };
const DIVISION_COLUMNS: PickableColumn[] = [
  { key: 'divRecord', label: 'Division' },
  { key: 'streak', label: 'Streak', from: 'md' },
  { key: 'pa', label: 'Pts against', from: 'md' },
  { key: 'maxPf', label: 'Max PF', from: 'md' },
];
const MAX_PF_TIP = "Max points: what the team's best possible lineup would have scored every week so far. The gap to Points is what its lineup choices left on the bench";
/** The same for the overall standings (leagues without divisions): no division record */
const OVERALL_COLUMNS = DIVISION_COLUMNS.filter((c) => c.key !== 'divRecord');

/** Extra per-team info for live standings ("if the week ended now") */
export interface StandingAnnotation {
  /** Record before the live week, shown as "2-2 →" */
  previousRecord: string;
  /** Real matchup this week: currently winning, losing or tied */
  liveResult: 'W' | 'L' | 'T' | null;
  /** Moving into or dropping out of a playoff spot compared with before the week */
  playoffChange: 'in' | 'out' | null;
  /** Projected standings: a game close to even (under 60/40), so its projected result is far from sure */
  tossUp?: boolean;
}

interface PlayoffRaceProps {
  divisions: DivisionStanding[];
  wildCard: WildCardStanding[];
  standings: TeamStats[];
  playoffTeams: number;
  /** Keyed by roster ID; when given, rows show live-week details */
  annotations?: Map<number, StandingAnnotation>;
  /** Division photos set in Sleeper, by division number */
  divisionAvatars?: Record<number, string>;
  /** Playoff odds by roster ID for the division cards' odds column (null while loading); omit for none */
  playoffOdds?: Record<number, number> | null;
}

interface TeamRowProps {
  team: TeamStats;
  rank: number;
  gamesBack?: number;
  pointsBack?: number;
  isLeader?: boolean;
  showDivision?: boolean;
  /** The division cards' extra columns (record in the division, streak, points against, playoff odds) */
  cols?: ColumnPicker;
  /** Playoff odds (0-1) when the odds column is shown, null while they load */
  odds?: number | null;
  isInPlayoffs?: boolean;
  showCutoffLine?: boolean;
  annotation?: StandingAnnotation;
}

/** A header that's shorter on phones */
function Short({ short, long }: { short: string; long: string }) {
  return (
    <>
      <span className="sm:hidden" aria-hidden>{short}</span>
      <span className="hidden sm:inline">{long}</span>
      <span className="sr-only sm:hidden">{long}</span>
    </>
  );
}

/** Team photo, falling back to the initial if it's missing or fails to load */
function TeamAvatar({ url, name }: { url: string | null | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" onError={() => setFailed(true)} className="w-10 h-10 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div className="w-10 h-10 shrink-0 rounded-full bg-[var(--neutral-bg)] flex items-center justify-center text-[var(--neutral-text)] font-semibold">
      {name.charAt(0)}
    </div>
  );
}

function TeamRow({
  team,
  rank,
  gamesBack,
  pointsBack,
  isLeader = false,
  showDivision = false,
  cols,
  odds,
  isInPlayoffs = false,
  showCutoffLine = false,
  annotation,
}: TeamRowProps) {
  const me = useMyTeam();
  /** Whether this table offers a column (the overall standings have no division record) */
  const has = (key: string) => !!cols?.columns.some((c) => c.key === key);
  return (
    <>
      <tr
        className={`
          ${mineRow(team.rosterId === me.rosterId)}
          ${isInPlayoffs ? 'bg-[var(--success-bg)]' : ''}
          ${isLeader ? 'font-semibold bg-[var(--info-bg)]' : ''}
          hover:bg-[var(--hover)] transition-colors
        `}
      >
        <td className="whitespace-nowrap px-3 py-3 text-sm text-[var(--foreground)] sm:px-4">
          {rank}
          {isLeader && <span className="ml-1">🥇</span>}
        </td>
        <td className="px-3 py-3 sm:px-4">
          <div className="flex items-center gap-3">
            {/* No photo on phones, so the name has room */}
            <span className="hidden sm:block">
              <TeamAvatar url={team.avatarUrl} name={team.teamName} />
            </span>
            <div>
              <div className="text-sm font-medium text-[var(--foreground)]">
                {team.teamName}
              </div>
              <div className="max-w-[7rem] truncate text-xs text-[var(--muted)] sm:max-w-none" title={team.username}><ManagerLink username={team.username} /></div>
              {/* The division column is hidden on phones */}
              {showDivision && <div className="max-w-[7rem] truncate text-xs text-[var(--muted)] sm:hidden">{team.divisionName || `Div ${team.division}`}</div>}
              {annotation?.playoffChange && (
                <div
                  className="whitespace-nowrap text-xs font-medium"
                  style={{ color: RESULT_DOT_COLORS[annotation.playoffChange === 'in' ? 'W' : 'L'] }}
                >
                  {annotation.playoffChange === 'in' ? 'moving in' : 'dropping out'}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-[var(--foreground)] whitespace-nowrap">
          {annotation && <span className="block text-xs text-[var(--muted)] font-normal sm:inline sm:text-sm">{annotation.previousRecord} → </span>}
          {team.wins}-{team.losses}
          {team.ties > 0 && `-${team.ties}`}
          {annotation && <span className="ml-2"><ResultDot result={annotation.liveResult} live /></span>}
          {annotation?.tossUp && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">toss-up</span>}
        </td>
        {cols && odds !== undefined && (
          <td className={`${cols.col('odds')} whitespace-nowrap px-4 py-3 text-sm tabular-nums text-[var(--foreground)]`}>
            {odds === null ? '…' : formatOdds(odds)}
          </td>
        )}
        {cols && has('divRecord') && (
          <td className={`${cols.col('divRecord')} whitespace-nowrap px-4 py-3 text-sm text-[var(--foreground)]`}>
            {team.divisionRecord
              ? `${team.divisionRecord.wins}-${team.divisionRecord.losses}${team.divisionRecord.ties > 0 ? `-${team.divisionRecord.ties}` : ''}`
              : '—'}
          </td>
        )}
        {cols && (
          <td className={`${cols.col('streak')} whitespace-nowrap px-4 py-3 text-sm font-medium`}>
            {team.streak ? (
              <span style={{ color: RESULT_DOT_COLORS[team.streak.result] }}>
                {team.streak.result}
                {team.streak.count}
              </span>
            ) : (
              '—'
            )}
          </td>
        )}
        <td className="px-4 py-3 text-sm text-[var(--foreground)]">
          {team.totalPoints.toFixed(2)}
        </td>
        {cols && (
          <td className={`${cols.col('pa')} whitespace-nowrap px-4 py-3 text-sm text-[var(--foreground)]`}>
            {team.pointsAgainst.toFixed(2)}
          </td>
        )}
        {cols && (
          <td className={`${cols.col('maxPf')} whitespace-nowrap px-4 py-3 text-sm text-[var(--foreground)]`}>
            {team.maxPoints !== undefined ? team.maxPoints.toFixed(2) : '—'}
          </td>
        )}
        {showDivision && (
          <td className="hidden px-4 py-3 text-xs sm:table-cell">
            <span className="inline-block whitespace-nowrap px-2 py-1 bg-[var(--neutral-bg)] text-[var(--neutral-text)] rounded">
              {team.divisionName || `Div ${team.division}`}
            </span>
          </td>
        )}
        <td className="px-4 py-3 text-sm text-[var(--foreground)] font-semibold">
          {gamesBack !== undefined && gamesBack > 0 ? '+' : ''}
          {gamesBack !== undefined && gamesBack !== 0 ? Math.abs(gamesBack).toFixed(1) : ''}
          {(gamesBack === 0) && '—'}
        </td>
        <td className="px-4 py-3 text-sm text-[var(--foreground)] font-semibold">
          {pointsBack !== undefined && pointsBack !== 0
            ? (pointsBack > 0 ? `+${pointsBack.toFixed(2)}` : Math.abs(pointsBack).toFixed(2))
            : ''}
          {(pointsBack === 0) && '—'}
        </td>
      </tr>
      {showCutoffLine && (
        <tr>
          <td colSpan={99} className="px-0 py-0">
            <div className="border-t-2 border-dashed border-red-500 relative">
              {/* At the left on phones, where the middle of a wide table can be off-screen */}
              <span className="absolute -top-2.5 left-3 bg-[var(--surface-elevated)] px-2 text-xs font-semibold text-red-500 sm:left-1/2 sm:-translate-x-1/2">
                PLAYOFF CUTOFF
              </span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DivisionCard({
  division,
  annotations,
  avatar,
  cols,
  odds,
}: {
  division: DivisionStanding;
  annotations?: Map<number, StandingAnnotation>;
  avatar?: string;
  cols: ColumnPicker;
  /** Each team's playoff odds by roster ID (null while loading); undefined: no odds column */
  odds?: Record<number, number> | null;
}) {
  const leaderPoints = Math.max(...division.teams.map(t => t.totalPoints));
  return (
    <div className="section-card bg-[var(--surface-elevated)] rounded-lg shadow overflow-hidden">
      <div className="section-header bg-gradient-to-r from-blue-500 to-blue-700 px-4 py-3" data-tone="primary">
        <h3 className="flex items-center gap-2.5 text-lg font-bold text-white">
          {avatar && <Image src={avatar} alt="" width={32} height={32} unoptimized className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/30" />}
          {division.divisionName || `Division ${division.division}`}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-12"><Short short="#" long="Rank" /></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-56">Team</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-20"><Short short="W-L" long="Record" /></th>
              {odds !== undefined && (
                <th className={`${cols.col('odds')} px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-20`}><Term tip="Playoff odds: the chance of making the playoffs, from the model on the Playoffs tab">Odds</Term></th>
              )}
              <th className={`${cols.col('divRecord')} px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-20`}><Term tip="Division record: wins and losses in regular-season games against this division's other teams. Standings ties are broken by points, not by this">Div</Term></th>
              <th className={`${cols.col('streak')} px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-16`}><Term tip="Streak: the current run of wins (W) or losses (L) in a row">Strk</Term></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-24"><Short short="Pts" long="Points" /></th>
              <th className={`${cols.col('pa')} px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-24`}><Term tip="Points against: what this team's opponents have scored against it">PA</Term></th>
              <th className={`${cols.col('maxPf')} px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-24`}><Term tip={MAX_PF_TIP} align="right">Max PF</Term></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-20"><Term tip="Games back: how far behind the division leader, in games (a win for one team and a loss for the other is one game)">GB</Term></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-24"><Term tip="Points back: how many fewer points this team has scored than the division's top scorer" align="right">PB</Term></th>
            </tr>
          </thead>
          <tbody className="bg-[var(--surface-elevated)] divide-y divide-[var(--border)]">
            {division.teams.map((team) => (
              <TeamRow
                key={team.username}
                team={team}
                rank={team.divisionRank || 0}
                gamesBack={team.gamesBack}
                pointsBack={team.totalPoints - leaderPoints}
                isLeader={team.isDivisionLeader}
                cols={cols}
                odds={odds === undefined ? undefined : odds === null ? null : (odds[team.rosterId] ?? 0)}
                annotation={annotations?.get(team.rosterId)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OverallStandingsCard({
  standings,
  playoffTeams,
  annotations,
  odds,
}: {
  standings: TeamStats[];
  playoffTeams: number;
  annotations?: Map<number, StandingAnnotation>;
  /** Each team's playoff odds by roster ID (null while loading); undefined: no odds column */
  odds?: Record<number, number> | null;
}) {
  const cols = useColumnPicker('overall-standings', odds !== undefined ? [ODDS_COLUMN, ...OVERALL_COLUMNS] : OVERALL_COLUMNS);
  const th = 'px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase';
  const hasCutoff = playoffTeams > 0 && standings.length > 0;
  const cutoffIndex = hasCutoff ? Math.min(playoffTeams, standings.length) - 1 : -1;
  const cutoffTeam = hasCutoff ? standings[cutoffIndex] : undefined;

  const getGamesBack = (team: TeamStats) => {
    if (!cutoffTeam) {
      return 0;
    }

    const winDiff = cutoffTeam.wins - team.wins;
    const lossDiff = team.losses - cutoffTeam.losses;
    return -(winDiff + lossDiff) / 2;
  };

  return (
    <SectionCard
      title="Standings"
      subtitle="Overall league standings"
      gradientType="primary"
    >
      <ColumnChips picker={cols} />
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-12"><Short short="#" long="Rank" /></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-56">Team</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-20"><Short short="W-L" long="Record" /></th>
              {odds !== undefined && (
                <th className={`${cols.col('odds')} ${th} w-20`}><Term tip="Playoff odds: the chance of making the playoffs, from the model on the Playoffs tab">Odds</Term></th>
              )}
              <th className={`${cols.col('streak')} ${th} w-16`}><Term tip="Streak: the current run of wins (W) or losses (L) in a row">Strk</Term></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-24"><Short short="Pts" long="Points" /></th>
              <th className={`${cols.col('pa')} ${th} w-24`}><Term tip="Points against: what this team's opponents have scored against it">PA</Term></th>
              <th className={`${cols.col('maxPf')} ${th} w-24`}><Term tip={MAX_PF_TIP} align="right">Max PF</Term></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-20"><Term tip="Games back from the last playoff spot: + means ahead of it, by that many games">GB</Term></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-24"><Term tip="Points ahead (+) of or behind the team holding the last playoff spot; points scored are the tiebreaker" align="right">PB</Term></th>
            </tr>
          </thead>
          <tbody className="bg-[var(--surface-elevated)] divide-y divide-[var(--border)]">
            {standings.map((team, index) => (
              <TeamRow
                key={team.username}
                team={team}
                rank={team.standing}
                gamesBack={getGamesBack(team)}
                pointsBack={cutoffTeam ? team.totalPoints - cutoffTeam.totalPoints : 0}
                isLeader={team.standing === 1}
                isInPlayoffs={hasCutoff && team.standing <= playoffTeams}
                showCutoffLine={hasCutoff && index === cutoffIndex}
                cols={cols}
                odds={odds === undefined ? undefined : odds === null ? null : (odds[team.rosterId] ?? 0)}
                annotation={annotations?.get(team.rosterId)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function WildCardCard({
  wildCard,
  annotations,
}: {
  wildCard: WildCardStanding[];
  annotations?: Map<number, StandingAnnotation>;
}) {
  const lastInPoints = wildCard.filter(wc => wc.isIn).slice(-1)[0]?.team.totalPoints || 0;
  return (
    <SectionCard
      title="Wild Card Race"
      subtitle="Non-division leaders competing for playoff spots"
      gradientType="accent"
    >
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase"><Short short="#" long="Rank" /></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase">
                Team
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase"><Short short="W-L" long="Record" /></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase"><Short short="Pts" long="Points" /></th>
              <th className="hidden px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase sm:table-cell">Division</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase">
                <Term tip="Games back from the last wild card spot: + means ahead of it, by that many games">GB</Term>
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase">
                <Term tip="Points ahead (+) of or behind the last team in; points scored are the tiebreaker" align="right">PB</Term>
              </th>
            </tr>
          </thead>
          <tbody className="bg-[var(--surface-elevated)] divide-y divide-[var(--border)]">
            {wildCard.map((standing, index) => {
              // Find the cutoff - last team that's IN
              const isLastIn = standing.isIn && (!wildCard[index + 1] || !wildCard[index + 1].isIn);

              return (
                <TeamRow
                  key={standing.team.username}
                  team={standing.team}
                  rank={standing.rank}
                  gamesBack={standing.gamesOut}
                  pointsBack={standing.team.totalPoints - lastInPoints}
                  showDivision={true}
                  isInPlayoffs={standing.isIn}
                  showCutoffLine={isLastIn}
                  annotation={annotations?.get(standing.team.rosterId)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

export default function PlayoffRace({ divisions, wildCard, standings, playoffTeams, annotations, divisionAvatars, playoffOdds }: PlayoffRaceProps) {
  // One picker for every division card, so adding a column on a phone adds it to all of them
  const divisionCols = useColumnPicker(
    'division-standings',
    playoffOdds !== undefined ? [ODDS_COLUMN, ...DIVISION_COLUMNS] : DIVISION_COLUMNS
  );
  return (
    <div className="space-y-6">
      {/* Division Standings or Overall Standings */}
      {divisions.length > 0 ? (
        <div className="space-y-6">
          {/* One row of chips for every division card (phones only) */}
          <div className="-mx-4 mb-2 sm:hidden">
            <ColumnChips picker={divisionCols} />
          </div>
          {divisions.map((division) => (
            <DivisionCard key={division.division} division={division} annotations={annotations} avatar={divisionAvatars?.[division.division]} cols={divisionCols} odds={playoffOdds} />
          ))}
        </div>
      ) : (
        <OverallStandingsCard standings={standings} playoffTeams={playoffTeams} annotations={annotations} odds={playoffOdds} />
      )}

      {/* Wild Card Race */}
      {wildCard.length > 0 && (
        <WildCardCard wildCard={wildCard} annotations={annotations} />
      )}
    </div>
  );
}
