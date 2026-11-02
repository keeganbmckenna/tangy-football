/**
 * A share link's page (app/share): the card's picture and a button into the site at that week (and
 * matchup). Chat apps read its preview (picture and description) from the page's metadata.
 */

import Link from 'next/link';
import OpenLive from '@/components/OpenLive';

interface Props {
  title: string;
  /** The card's picture (the route's opengraph-image) */
  image: string;
  /** Where "Open in Tangy Football" goes */
  href: string;
  /** A week being played: go straight on to the live view */
  live?: boolean;
}

export default function SharePage({ title, image, href, live = false }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-4 py-8 sm:py-12">
      {live && <OpenLive href={href} />}
      {live && <p className="text-sm text-[var(--muted)]">Opening the live scores…</p>}
      <p className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Tangy Football</p>
      <h1 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">{title}</h1>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt={title} width={1200} height={630} className="h-auto w-full rounded-xl border border-[var(--border)]" />
      <Link
        href={href}
        className="self-start rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-white hover:opacity-90"
      >
        Open in Tangy Football
      </Link>
    </main>
  );
}
