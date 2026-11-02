import type { Metadata } from 'next';
import { headers } from 'next/headers';
import App from '@/components/App';
import { originOf } from '@/lib/shareData';
import { previewFor } from '@/lib/sharePreview';

/**
 * The site. Built per request only for its link preview (lib/sharePreview.ts): an address naming a
 * matchup, a week or a manager previews as that, in chat apps and on social sites.
 */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  return previewFor(originOf(await headers()), await searchParams);
}

export default function Page() {
  return <App />;
}
