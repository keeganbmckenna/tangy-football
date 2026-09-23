'use client';

import { useEffect, useState } from 'react';
import SectionCard from '@/components/ui/SectionCard';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  DraftData,
  DraftPickData,
  buildSnakeBoard,
  buildAuctionBoardByTeam,
  summarizeDraftByTeam,
  positionBadgeClass,
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
          {pick.median_ppg.toFixed(1)}<span className="font-normal text-[var(--muted)]">/wk</span>
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
    </div>
  );
}

function SnakeBoard({ data, leagueData }: { data: DraftData; leagueData: LeagueData | null }) {
  const rows = buildSnakeBoard(data.picks, data.teams);
  const slots = Array.from({ length: data.teams }, (_, i) => i + 1);

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-[var(--muted)] uppercase sticky left-0 bg-[var(--surface)] z-10">
              Rd
            </th>
            {slots.map((slot) => (
              <th
                key={slot}
                className="px-2 py-2 text-center text-xs font-medium text-[var(--muted)] uppercase whitespace-nowrap"
              >
                Slot {slot}
              </th>
            ))}
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

function AuctionBoard({ data, leagueData }: { data: DraftData; leagueData: LeagueData | null }) {
  const teams = buildAuctionBoardByTeam(data.picks);

  return (
    <div className="space-y-6">
      {teams.map((team) => (
        <div key={team.rosterId ?? 'none'} className="overflow-x-auto">
          <h3 className="px-6 pt-4 pb-2 text-sm font-bold text-[var(--foreground)] uppercase tracking-wider">
            {teamNameForRoster(leagueData, team.rosterId)}
            <span className="ml-2 text-xs font-normal normal-case text-[var(--muted)]">
              {team.picks.length} picks · ${team.spent} spent · {team.haulMedian.toFixed(1)}/wk typical
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
                    <span className="font-semibold">{pick.median_ppg.toFixed(1)}</span>
                    <span className="text-[var(--muted)]">/wk · {pick.games}g</span>
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

function TeamSummary({ data, leagueData }: { data: DraftData; leagueData: LeagueData | null }) {
  const summaries = summarizeDraftByTeam(data.picks);
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
              Typical haul/wk
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
                {s.haulMedian.toFixed(1)}
              </td>
              <td className="px-6 py-3 whitespace-nowrap text-sm text-[var(--muted)]">
                {s.bestPick ? (
                  <>
                    {s.bestPick.name}
                    <span className="text-xs"> ({s.bestPick.median_ppg.toFixed(1)}/wk{s.bestPick.amount ? `, $${s.bestPick.amount}` : ''})</span>
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    fetch(`/data/drafts/${season}.json`)
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json() as Promise<DraftData>;
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
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
  }, [season]);

  if (loading) {
    return <LoadingSpinner message={`Loading ${season} draft...`} />;
  }

  if (notFound || !data) {
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
            <strong>Median weekly points</strong> (half-PPR) over games played — the typical week each
            pick produced, resistant to single boom-week spikes. <strong>Typical haul/wk</strong> sums
            every pick&apos;s median: roughly what the draft class produces in an average week.
            {data.type === 'auction' && (
              <> <strong>$/pt</strong> is dollars spent per typical weekly point (lower is better).</>
            )}
          </span>
        }
      >
        {data.type === 'auction' ? (
          <AuctionBoard data={data} leagueData={leagueData} />
        ) : (
          <SnakeBoard data={data} leagueData={leagueData} />
        )}
      </SectionCard>

      <SectionCard title="Draft Results" subtitle="Per-team haul from this draft" gradientType="info">
        <TeamSummary data={data} leagueData={leagueData} />
      </SectionCard>
    </div>
  );
}
