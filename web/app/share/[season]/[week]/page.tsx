import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import SharePage from '@/components/SharePage';
import { originOf, picturePath, shareWeek, type ShareWeek } from '@/lib/shareData';

type Params = { params: Promise<{ season: string; week: string }> };

const load = async ({ params }: Params) => {
  const { season, week } = await params;
  return shareWeek(originOf(await headers()), season, Number(week));
};

const title = (w: ShareWeek) => `Week ${w.week} ${w.status === 'final' ? 'recap' : 'so far'}, ${w.season}`;

/** The link preview's description: the awards (or the live scores) and the biggest swing */
const lines = (w: ShareWeek) => [
  ...(w.awards.length
    ? w.awards.map((a) => `${a.label}: ${a.who} (${a.detail})`)
    : w.games.map((g) => `${g.a.name} ${g.a.score.toFixed(1)} - ${g.b.score.toFixed(1)} ${g.b.name}`)),
  ...(w.swing ? [`Biggest swing (${w.swing.matchup}): ${w.swing.desc}`] : []),
];

export async function generateMetadata(props: Params): Promise<Metadata> {
  const w = await load(props);
  if (!w) return { title: 'Tangy Football' };
  const description = lines(w).slice(0, 3).join(' · ');
  const image = { url: `${originOf(await headers())}${picturePath(`/share/${w.season}/${w.week}/image`, w.status)}`, width: 1200, height: 630, alt: title(w) };
  return { title: `${title(w)} · Tangy Football`, description, openGraph: { title: title(w), description, type: 'article', images: [image] }, twitter: { card: 'summary_large_image', images: [image.url] } };
}

/** A week's share link: its recap (or, while it's being played, every matchup's score) */
export default async function WeekShare(props: Params) {
  const w = await load(props);
  if (!w) notFound();
  return (
    <SharePage
      title={title(w)}
      href={`/?season=${w.season}&week=${w.week}`}
    />
  );
}
