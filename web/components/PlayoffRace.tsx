'use client';

import Image from 'next/image';
import { useState } from 'react';
import { mineRow, useMyTeam } from '@/hooks/useMyTeam';
import { TeamStats, DivisionStanding, WildCardStanding } from '@/lib/types';
import SectionCard from './ui/SectionCard';
import ResultDot from './ui/ResultDot';
import { RESULT_DOT_COLORS } from '@/lib/constants';
import Term from './ui/Term';

/** Extra per-team info for live standings ("if the week ended now") */
export interface StandingAnnotation {
  /** Record before the live week, shown as "2-2 →" */
  previousRecord: string;
  /** Real matchup this week: currently winning, losing or tied */
  liveResult: 'W' | 'L' | 'T' | null;
  /** Moving into or dropping out of a playoff spot compared with before the week */
  playoffChange: 'in' | 'out' | null;
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
}

interface TeamRowProps {
  team: TeamStats;
  rank: number;
  gamesBack?: number;
  pointsBack?: number;
  isLeader?: boolean;
  showDivision?: boolean;
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
  isInPlayoffs = false,
  showCutoffLine = false,
  annotation,
}: TeamRowProps) {
  const me = useMyTeam();
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
              <div className="max-w-[7rem] truncate text-xs text-[var(--muted)] sm:max-w-none" title={team.username}>@{team.username}</div>
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
        </td>
        <td className="px-4 py-3 text-sm text-[var(--foreground)]">
          {team.totalPoints.toFixed(2)}
        </td>
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
          <td colSpan={showDivision ? 8 : 7} className="px-0 py-0">
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

function DivisionCard({ division, annotations, avatar }: { division: DivisionStanding; annotations?: Map<number, StandingAnnotation>; avatar?: string }) {
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
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-24"><Short short="Pts" long="Points" /></th>
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
}: {
  standings: TeamStats[];
  playoffTeams: number;
  annotations?: Map<number, StandingAnnotation>;
}) {
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
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--surface)]">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-12"><Short short="#" long="Rank" /></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-56">Team</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-20"><Short short="W-L" long="Record" /></th>
              <th className="px-4 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase w-24"><Short short="Pts" long="Points" /></th>
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

export default function PlayoffRace({ divisions, wildCard, standings, playoffTeams, annotations, divisionAvatars }: PlayoffRaceProps) {
  return (
    <div className="space-y-6">
      {/* Division Standings or Overall Standings */}
      {divisions.length > 0 ? (
        <div className="space-y-6">
          {divisions.map((division) => (
            <DivisionCard key={division.division} division={division} annotations={annotations} avatar={divisionAvatars?.[division.division]} />
          ))}
        </div>
      ) : (
        <OverallStandingsCard standings={standings} playoffTeams={playoffTeams} annotations={annotations} />
      )}

      {/* Wild Card Race */}
      {wildCard.length > 0 && (
        <WildCardCard wildCard={wildCard} annotations={annotations} />
      )}
    </div>
  );
}
