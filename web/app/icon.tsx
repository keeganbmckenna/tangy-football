import { ImageResponse } from 'next/og';
import { SLEEPER_CONFIG } from '@/lib/config';

const LEAGUE_ID = SLEEPER_CONFIG.leagueId;

export const size = {
  width: 32,
  height: 32,
};
export const contentType = 'image/png';

export default async function Icon() {
  try {
    // Fetch league data directly from Sleeper API
    const response = await fetch(
      `https://api.sleeper.app/v1/league/${LEAGUE_ID}`,
      { next: { revalidate: 3600 } } // Cache for 1 hour
    );

    if (!response.ok) {
      console.error('Failed to fetch league data:', response.status);
      throw new Error('Failed to fetch league data');
    }

    const league = await response.json();

    if (league.avatar) {
      // Render avatar as a circular image using ImageResponse
      const avatarUrl = `https://sleepercdn.com/avatars/thumbs/${league.avatar}`;

      return new ImageResponse(
        (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'transparent',
            }}
          >
            <img
              src={avatarUrl}
              alt="League Avatar"
              width={32}
              height={32}
              style={{
                borderRadius: '50%',
              }}
            />
          </div>
        ),
        {
          ...size,
        }
      );
    }

    // Fallback: Return a simple colored square if no avatar
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#3b82f6',
            color: 'white',
            fontSize: 20,
            fontWeight: 'bold',
          }}
        >
          🏈
        </div>
      ),
      {
        ...size,
      }
    );
  } catch (error) {
    console.error('Error generating icon:', error);
    // Fallback icon
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#3b82f6',
            color: 'white',
            fontSize: 20,
            fontWeight: 'bold',
          }}
        >
          🏈
        </div>
      ),
      {
        ...size,
      }
    );
  }
}
