/**
 * Link previews for the site's own addresses (app/page.tsx): a matchup (?season=&week=&matchup=, the
 * sharer's team first with &me=), a week (?season=&week=), a manager page (?tab=history&manager=),
 * or the league itself. Each points at its picture in app/preview (lib/shareImage.tsx). A plain
 * visit costs nothing: only an address that names a week or a manager looks anything up.
 */

import type { Metadata } from 'next';
import { CACHE_CONFIG, SLEEPER_CONFIG } from '@/lib/config';
import { cachedHistory } from '@/lib/historyData';
import { fetchJson } from '@/lib/oddsData';
import { managerProfile } from '@/lib/analyze/managerProfile';
import { firstSide, picturePath, shareMatchup, shareWeek, type ShareMatchup, type ShareWeek } from '@/lib/shareData';
import type { SleeperLeague } from '@/lib/types';

const SITE = 'Tangy Football';

/**
 * Metadata with a 1200 x 630 picture, for chat apps and social sites. The browser tab keeps the
 * site's title (the layout's): the preview's is only for the preview.
 */
function card(origin: string, title: string, description: string, picture: string): Metadata {
  const image = { url: `${origin}${picture}`, width: 1200, height: 630, alt: title };
  return {
    description,
    openGraph: { title, description, type: 'website', siteName: SITE, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

export const matchupTitle = (m: ShareMatchup) => `${m.a.name} ${m.a.score.toFixed(2)} - ${m.b.score.toFixed(2)} ${m.b.name}`;

/** Where a matchup stands and the play that swung it most */
export function matchupLines(m: ShareMatchup): string[] {
  const p = m.odds?.[m.odds.length - 1];
  return [
    `${m.season} week ${m.week}, ${m.status === 'final' ? 'final' : 'live'}${m.leadChanges ? ` · ${m.leadChanges} lead change${m.leadChanges === 1 ? '' : 's'}` : ''}`,
    ...(m.status === 'live' && p !== undefined ? [`${p >= 0.5 ? m.a.name : m.b.name} ${Math.round(Math.max(p, 1 - p) * 100)}% to win`] : []),
    ...(m.swing ? [`Biggest swing: ${m.swing.desc} (${m.swing.team} ${Math.round(m.swing.from * 100)}% to ${Math.round(m.swing.to * 100)}%)`] : []),
  ];
}

export const weekTitle = (w: ShareWeek) => `Week ${w.week} ${w.status === 'final' ? 'recap' : 'so far'}, ${w.season}`;

/** The week's awards (or its live scores) and its biggest swing */
export function weekLines(w: ShareWeek): string[] {
  return [
    ...(w.awards.length
      ? w.awards.map((a) => `${a.label}: ${a.who} (${a.detail})`)
      : w.games.map((g) => `${g.a.name} ${g.a.score.toFixed(2)} - ${g.b.score.toFixed(2)} ${g.b.name}`)),
    ...(w.swing ? [`Biggest swing (${w.swing.matchup}): ${w.swing.desc}`] : []),
  ];
}

/** The league's current season (the address's season when it names one) */
async function currentSeason(): Promise<string> {
  const league = await fetchJson<SleeperLeague>(`${SLEEPER_CONFIG.baseUrl}/league/${SLEEPER_CONFIG.leagueId}`, CACHE_CONFIG.leagueData);
  return league.season;
}

/** The preview for an address of the site (the league's own for a plain visit or one that can't be built) */
export async function previewFor(origin: string, query: Record<string, string | string[] | undefined>): Promise<Metadata> {
  const get = (k: string) => {
    const v = query[k];
    return typeof v === 'string' ? v : undefined;
  };
  const week = Number(get('week'));
  const matchup = Number(get('matchup'));
  const manager = get('manager');
  try {
    if (get('tab') === 'history' && manager && /^\d{1,24}$/.test(manager)) {
      const history = await cachedHistory();
      const p = managerProfile(history, manager);
      const m = history.managers.find((x) => x.userId === manager);
      if (p && m) {
        const titles = p.seasons.filter((s) => s.champion).length;
        const description = [
          `${p.totals.wins}-${p.totals.losses}${p.totals.ties ? `-${p.totals.ties}` : ''} over ${p.totals.seasons} seasons`,
          titles ? `${titles} title${titles === 1 ? '' : 's'}` : null,
          p.totals.scoredGames ? `${p.totals.pointsPerGame.toFixed(1)} points per game` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return card(origin, `${m.name} in the league's history`, description, `/preview/manager/${manager}`);
      }
    }
    if (Number.isInteger(week) && week >= 1) {
      const season = get('season') ?? (await currentSeason());
      if (Number.isInteger(matchup) && matchup >= 1) {
        const m = await shareMatchup(origin, season, week, matchup, firstSide(get('me')));
        if (m) return card(origin, matchupTitle(m), matchupLines(m).join(' · '), picturePath(`/preview/${season}/${week}/${matchup}`, m.status, { me: m.a.rosterId }));
      }
      const w = await shareWeek(origin, season, week);
      if (w) return card(origin, weekTitle(w), weekLines(w).slice(0, 3).join(' · '), picturePath(`/preview/${season}/${week}`, w.status));
    }
  } catch (error) {
    // A preview that can't be built falls back to the league's
    console.error('Link preview failed:', error);
  }
  return card(origin, SITE, 'Standings, live win odds, playoff odds and league history', '/preview/league');
}
