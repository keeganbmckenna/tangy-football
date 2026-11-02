/**
 * A share link's page (app/share): the card's picture, what it shows in words, and a button into
 * the site at that week (and matchup). Chat apps read its preview from the page's metadata.
 */

import Link from 'next/link';

interface Props {
  title: string;
  lines: string[];
  /** The card's picture (the route's opengraph-image) */
  image: string;
  /** Where "Open in Tangy Football" goes */
  href: string;
}

export default function SharePage({ title, lines, image, href }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-4 py-8 sm:py-12">
      <p className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">Tangy Football</p>
      <h1 className="text-2xl font-bold text-[var(--foreground)] sm:text-3xl">{title}</h1>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt={title} width={1200} height={630} className="h-auto w-full rounded-xl border border-[var(--border)]" />
      <ul className="space-y-1 text-[var(--foreground)]">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <Link
        href={href}
        className="self-start rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-white hover:opacity-90"
      >
        Open in Tangy Football
      </Link>
    </main>
  );
}
