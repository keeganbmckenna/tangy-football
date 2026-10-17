import { ImageResponse } from 'next/og';
import { SLEEPER_CONFIG } from '@/lib/config';

/**
 * The league's Sleeper photo as a square app icon (phones round or mask the
 * corners themselves), or a football on black if there's no photo.
 */
export async function leagueAppIcon(size: number) {
  // Fetched up front as a data URL, so a failed download falls back instead of failing the render
  let avatar: string | null = null;
  try {
    const res = await fetch(`${SLEEPER_CONFIG.baseUrl}/league/${SLEEPER_CONFIG.leagueId}`, { next: { revalidate: 3600 } });
    const id = res.ok ? (await res.json()).avatar : null;
    if (id) {
      const img = await fetch(`https://sleepercdn.com/avatars/${id}`, { next: { revalidate: 3600 } });
      if (img.ok) {
        const type = img.headers.get('content-type') ?? 'image/png';
        avatar = `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
      }
    }
  } catch {
    // Fall back to the football
  }
  return new ImageResponse(
    avatar ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={avatar} alt="" width={size} height={size} style={{ objectFit: 'cover' }} />
    ) : (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000000',
          fontSize: size * 0.6,
        }}
      >
        🏈
      </div>
    ),
    { width: size, height: size }
  );
}
