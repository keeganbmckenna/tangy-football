import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import SharePage from '@/components/SharePage';
import { firstSide, originOf, shareMatchup, type ShareMatchup } from '@/lib/shareData';

type Params = { params: Promise<{ season: string; week: string; matchup: string }>; searchParams: Promise<{ me?: string }> };

const load = async ({ params, searchParams }: Params) => {
  const { season, week, matchup } = await params;
  const { me } = await searchParams;
  return shareMatchup(originOf(await headers()), season, Number(week), Number(matchup), firstSide(me));
};

/** The picture's path, with the same team first */
const imagePath = (m: ShareMatchup) => `/share/${m.season}/${m.week}/${m.matchupId}/image?me=${m.a.rosterId}`;

const title = (m: ShareMatchup) => `${m.a.name} ${m.a.score.toFixed(2)} - ${m.b.score.toFixed(2)} ${m.b.name}`;

/** What it says in words: where it stands and the play that swung it most */
const lines = (m: ShareMatchup) => {
  const p = m.odds?.[m.odds.length - 1];
  return [
    `${m.season} week ${m.week}, ${m.status === 'final' ? 'final' : 'live'}${m.leadChanges ? ` · ${m.leadChanges} lead change${m.leadChanges === 1 ? '' : 's'}` : ''}`,
    ...(m.status === 'live' && p !== undefined ? [`${p >= 0.5 ? m.a.name : m.b.name} ${Math.round(Math.max(p, 1 - p) * 100)}% to win`] : []),
    ...(m.swing ? [`Biggest swing: ${m.swing.desc} (${m.swing.team} ${Math.round(m.swing.from * 100)}% to ${Math.round(m.swing.to * 100)}%)`] : []),
  ];
};

export async function generateMetadata(props: Params): Promise<Metadata> {
  const m = await load(props);
  if (!m) return { title: 'Tangy Football' };
  const description = lines(m).join(' · ');
  const image = { url: `${originOf(await headers())}${imagePath(m)}`, width: 1200, height: 630, alt: title(m) };
  return { title: `${title(m)} · Tangy Football`, description, openGraph: { title: title(m), description, type: 'article', images: [image] }, twitter: { card: 'summary_large_image', images: [image.url] } };
}

/** A matchup's share link */
export default async function MatchupShare(props: Params) {
  const m = await load(props);
  if (!m) notFound();
  return (
    <SharePage
      title={title(m)}
      lines={lines(m)}
      image={imagePath(m)}
      href={`/?season=${m.season}&week=${m.week}&matchup=${m.matchupId}`}
    />
  );
}
