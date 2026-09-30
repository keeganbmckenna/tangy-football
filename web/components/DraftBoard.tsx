'use client';

import { useEffect, useMemo, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  DraftData,
  DraftPickData,
  buildSnakeBoard, buildSnakeSlotTeams,
  buildAuctionBoardByTeam,
  summarizeDraftByTeam,
  positionBadgeClass,
  ppwOf,
  withAvailability,
  buildDraftCore,
  type TeamCore,
} from '@/lib/analyze/draft';
import type { LeagueData } from '@/lib/types';

interface DraftBoardProps {
  season: string;
  leagueData: LeagueData | null;
}

function teamNameForRoster(leagueData: LeagueData | null, rosterId: number | null): string {
  if (!leagueData || rosterId === null || rosterId === undefined) return '—';
  const userId = leagueData.rosterToUserMap[rosterId];
  const user = userId ? leagueData.userMap[userId] : undefined;
  return user?.display_name || user?.username || `Team ${rosterId}`;
}

function PickCell({ pick }: { pick: DraftPickData }) {
  return (
    <div className="min-w-[128px] max-w-[160px]">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-[var(--muted)]">#{pick.pick_no}</span>
        <span className="text-[11px] font-semibold text-[var(--foreground)]">
          {ppwOf(pick).toFixed(1)}<span className="font-normal text-[var(--muted)]">/wk</span>
        </span>
      </div>
      <div className="text-xs font-medium text-[var(--foreground)] truncate" title={pick.name}>
        {pick.name}
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className={`text-[10px] font-bold px-1 rounded ${positionBadgeClass(pick.position)}`}>
          {pick.position}
        </span>
        <span className="text-[10px] text-[var(--muted)]">{pick.nfl_team}</span>
        <span className="text-[10px] text-[var(--muted)]">· {pick.games}g</span>
      </div>
      <div className="text-[10px] text-[var(--muted)]">{pick.median_ppg.toFixed(1)} healthy</div>
    </div>
  );
}

function SnakeBoard({ data, leagueData }: { data: DraftData; leagueData: LeagueData | null }) {
  const rows = buildSnakeBoard(data.picks, data.teams);
  const slotTeams = buildSnakeSlotTeams(data.picks, data.teams);
  const slots = Array.from({ length: data.teams }, (_, i) => i + 1);

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase sticky left-0 bg-[var(--surface)] z-10">
              Rd
            </th>
            {slots.map((slot) => {
              const rosterId = slotTeams[slot - 1];
              const label = rosterId !== null ? teamNameForRoster(leagueData, rosterId) : `Slot ${slot}`;
              return (
                <th
                  key={slot}
                  className="px-2 py-2 text-center text-xs font-medium text-[var(--muted)] uppercase whitespace-nowrap max-w-[140px] overflow-hidden text-ellipsis"
                  title={label}
                >
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <tr key={row.round}>
              <td className="px-3 py-2 text-sm font-bold text-[var(--muted)] sticky left-0 bg-[var(--surface-elevated)] z-10">
                {row.round}
              </td>
              {row.cells.map((pick, i) => (
                <td
                  key={i}
                  className="px-2 py-2 align-top border-l border-[var(--border)]"
                  title={pick ? `${pick.name} — drafted by ${teamNameForRoster(leagueData, pick.roster_id)}` : undefined}
                >
                  {pick ? <PickCell pick={pick} /> : <span className="text-[var(--muted)]">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuctionBoard({ data, leagueData, core }: { data: DraftData; leagueData: LeagueData | null; core: TeamCore[] }) {
  const teams = buildAuctionBoardByTeam(data.picks, core);

  return (
    <div className="space-y-6">
      {teams.map((team) => (
        <div key={team.rosterId ?? 'none'} className="overflow-x-auto">
          <h3 className="px-6 pt-4 pb-2 text-sm font-bold text-[var(--foreground)] uppercase tracking-wider">
            {teamNameForRoster(leagueData, team.rosterId)}
            <span className="ml-2 text-xs font-normal normal-case text-[var(--muted)]">
              {team.picks.length} picks · ${team.spent} spent · {(team.core ?? 0).toFixed(1)}/wk core
            </span>
          </h3>
          <table className="min-w-full divide-y divide-[var(--border)]">
            <tbody className="divide-y divide-[var(--border)]">
              {team.picks.map((pick) => (
                <tr key={pick.pick_no} className="hover:bg-[var(--surface)]">
                  <td className="px-6 py-2 whitespace-nowrap text-sm font-bold text-[var(--accent)] w-16">
                    ${pick.amount ?? '—'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mr-2 ${positionBadgeClass(pick.position)}`}>
                      {pick.position}
                    </span>
                    <span className="text-sm font-medium text-[var(--foreground)]">{pick.name}</span>
                    <span className="text-xs text-[var(--muted)] ml-2">{pick.nfl_team}</span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-right text-[var(--foreground)]">
                    <span className="font-semibold">{ppwOf(pick).toFixed(1)}</span>
                    <span className="text-[var(--muted)]">
                      /wk · {pick.median_ppg.toFixed(1)} healthy · {pick.games}g
                      {pick.available_weeks !== undefined && `/${pick.available_weeks}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function DraftCore({ data, leagueData, core }: {
  data: DraftData;
  leagueData: LeagueData | null;
  core: { labels: string[]; teams: TeamCore[] };
}) {
  const { labels, teams } = core;
  const isAuction = data.type === 'auction';

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-[var(--border)]">
        <thead className="bg-[var(--surface)]">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider sticky left-0 bg-[var(--surface)] z-10">
              Team
            </th>
            {labels.map((label) => (
              <th key={label} className="px-3 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
                {label}
              </th>
            ))}
            <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              Core/wk
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {teams.map((team) => (
            <tr key={team.rosterId ?? 'none'}>
              <td className="px-6 py-2 whitespace-nowrap text-sm font-medium text-[var(--foreground)] sticky left-0 bg-[var(--surface-elevated)] z-10">
                {teamNameForRoster(leagueData, team.rosterId)}
              </td>
              {team.slots.map(({ label, pick }) => (
                <td key={label} className="px-3 py-2 align-top">
                  {pick ? (
                    <div className="min-w-[110px] max-w-[150px]">
                      <div className="text-xs font-medium text-[var(--foreground)] truncate" title={pick.name}>
                        {pick.name}
                      </div>
                      <div className="text-[10px] text-[var(--muted)] whitespace-nowrap">
                        <span className="font-semibold text-[var(--foreground)]">{ppwOf(pick).toFixed(1)}</span>/wk
                        {' · '}
                        {isAuction ? `$${pick.amount ?? 0}` : `#${pick.pick_no}`}
                        {/^(QB|RB|WR|TE)\d*$/.test(label) ? '' : ` · ${pick.position}`}
                      </div>
                    </div>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
              ))}
              <td className="px-4 py-2 whitespace-nowrap text-sm text-right font-semibold text-[var(--foreground)]">
                {team.total.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamSummary({ data, leagueData, core }: { data: DraftData; leagueData: LeagueData | null; core: TeamCore[] }) {
  const summaries = summarizeDraftByTeam(data.picks, core);
  const isAuction = data.type === 'auction';

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-[var(--border)]">
        <thead className="bg-[var(--surface)]">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Team</th>
            {isAuction && (
              <>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Spent</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">$/pt</th>
              </>
            )}
            <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              Core/wk
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted)] uppercase tracking-wider">
              All picks/wk
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Best pick</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {summaries.map((s) => (
            <tr key={s.rosterId ?? 'none'}>
              <td className="px-6 py-3 whitespace-nowrap text-sm font-medium text-[var(--foreground)]">
                {teamNameForRoster(leagueData, s.rosterId)}
                <span className="text-xs text-[var(--muted)] ml-2">{s.count} picks</span>
              </td>
              {isAuction && (
                <>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-[var(--foreground)]">
                    ${s.spent}
                    {data.budget !== null && (
                      <span className="text-xs text-[var(--muted)]"> / ${data.budget}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-[var(--muted)]">
                    {s.dollarsPerPoint !== null ? `$${s.dollarsPerPoint}` : '—'}
                  </td>
                </>
              )}
              <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold text-[var(--foreground)]">
                {(s.core ?? 0).toFixed(1)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-[var(--muted)]">
                {s.haul.toFixed(1)}
              </td>
              <td className="px-6 py-3 whitespace-nowrap text-sm text-[var(--muted)]">
                {s.bestPick ? (
                  <>
                    {s.bestPick.name}
                    <span className="text-xs"> ({ppwOf(s.bestPick).toFixed(1)}/wk{s.bestPick.amount ? `, $${s.bestPick.amount}` : ''})</span>
                  </>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DraftBoard({ season, leagueData }: DraftBoardProps) {
  const [data, setData] = useState<DraftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // The in-progress season is built live from Sleeper so it tracks the latest
  // scored week; completed seasons never change and use pre-built JSON.
  const isLive =
    leagueData?.league.season === season && leagueData.league.status !== 'complete';
  // Lineup rules have changed over the years, so use this season's own slots
  const rosterPositions =
    leagueData?.league.season === season ? leagueData.league.roster_positions : undefined;
  const core = useMemo(
    () => (data ? buildDraftCore(data, rosterPositions) : null),
    [data, rosterPositions]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    const load = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('not found');
      return res.json() as Promise<DraftData>;
    };
    const staticUrl = `/data/drafts/${season}.json`;
    // If the live build fails, fall back to the last pre-built snapshot
    const request = isLive
      ? load(`/api/draft/${season}`).catch(() => load(staticUrl))
      : load(staticUrl);

    request
      .then((json) => {
        if (!cancelled) {
          setData(withAvailability(json));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [season, isLive]);

  if (loading) {
    return <LoadingSpinner message={`Loading ${season} draft...`} />;
  }

  if (notFound || !data || !core) {
    return (
      <SectionCard title={`${season} Draft`} subtitle="Draft board">
        <p className="px-6 py-8 text-[var(--muted)]">
          Draft data for the {season} season hasn&apos;t been generated yet.
        </p>
      </SectionCard>
    );
  }

  const typeLabel = data.type === 'auction' ? `Auction · $${data.budget} budget` : 'Snake';
  const subtitle = `${typeLabel} · ${data.picks.length} picks · ${data.weeks_scored} weeks scored`;

  return (
    <div className="space-y-8">
      <SectionCard
        title={`${data.season} Draft`}
        subtitle={subtitle}
        gradientType="warning"
        footer={
          <span>
            <strong>/wk</strong> is half-PPR points per available week: total points divided by the weeks
            the player could have played (weeks scored minus their bye), so games missed to injury,
            suspension or benching count as zeros. <strong>Healthy</strong> is the median over games
            actually played: how good they were on the field. Teams are ranked by{' '}
            <strong>Core/wk</strong> (see Draft Core below).
            {data.type === 'auction' && (
              <> <strong>$/pt</strong> is dollars spent per Core/wk point (lower is better).</>
            )}
          </span>
        }
      >
        {data.type === 'auction' ? (
          <AuctionBoard data={data} leagueData={leagueData} core={core.teams} />
        ) : (
          <SnakeBoard data={data} leagueData={leagueData} />
        )}
      </SectionCard>

      <SectionCard
        title="Draft Core"
        subtitle={data.type === 'auction'
          ? 'Most expensive player drafted for each starting slot'
          : 'Earliest pick for each starting slot'}
        gradientType="info"
        footer={
          <span>
            The players each team invested in to start: the {data.type === 'auction' ? 'most expensive' : 'earliest-drafted'}{' '}
            QB for QB, the top two RBs for RB1/RB2, and so on, with flex taking the top remaining eligible
            player. Slots follow this season&apos;s lineup rules; kickers and defenses aren&apos;t included.
            Each shows the player&apos;s /wk (injuries count as zeros, byes don&apos;t), and{' '}
            <strong>Core/wk</strong> adds them up: did the draft&apos;s big bets pay off?
          </span>
        }
      >
        <DraftCore data={data} leagueData={leagueData} core={core} />
      </SectionCard>

      <SectionCard title="Draft Results" subtitle="Teams ranked by Core/wk" gradientType="info">
        <TeamSummary data={data} leagueData={leagueData} core={core.teams} />
      </SectionCard>
    </div>
  );
}
