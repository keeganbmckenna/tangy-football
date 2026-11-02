import Link from 'next/link';

export const metadata = { title: 'Not found · Tangy Football' };

/** An address the site doesn't have: say so, and offer the way home */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="text-5xl" aria-hidden>
        🏈
      </div>
      <h1 className="text-2xl font-bold text-[var(--foreground)]">Incomplete pass</h1>
      <p className="text-[var(--muted)]">There&apos;s nothing at this address. It may have moved, or the link may be mistyped.</p>
      <Link href="/" className="rounded-lg bg-[var(--accent)] px-4 py-2 font-semibold text-white hover:opacity-90">
        Back to Tangy Football
      </Link>
    </main>
  );
}
