/**
 * A share link's page (app/share): chat apps show its preview (the card picture and description,
 * from the page's metadata); anyone who opens it goes straight on to that view of the site.
 */

import Link from 'next/link';
import OpenSite from '@/components/OpenSite';

interface Props {
  title: string;
  /** The view of the site to open: the week (and matchup) */
  href: string;
}

export default function SharePage({ title, href }: Props) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-3 px-4 py-8">
      <OpenSite href={href} />
      <p className="text-sm text-[var(--muted)]">Opening Tangy Football…</p>
      {/* Without scripts, or if the move doesn't happen */}
      <Link href={href} className="font-semibold text-[var(--accent)] hover:underline">
        {title}
      </Link>
    </main>
  );
}
