import { cachedHistory } from '@/lib/historyData';
import { managerProfile } from '@/lib/analyze/managerProfile';
import { managerImage } from '@/lib/shareImage';

/** A manager page's preview picture (lib/shareImage.tsx) */
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const history = await cachedHistory();
  const p = managerProfile(history, userId);
  const m = history.managers.find((x) => x.userId === userId);
  if (!p || !m) return new Response('Not found', { status: 404 });
  const avatar = p.seasons.find((s) => s.avatarUrl)?.avatarUrl ?? m.avatarUrl;
  return managerImage(p, m.name, avatar);
}
