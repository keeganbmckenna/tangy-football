import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'sleepercdn.com',
        pathname: '/avatars/**',
      },
      // Player headshots and team logos (the Live tab's matchup lineups)
      { protocol: 'https', hostname: 'sleepercdn.com', pathname: '/content/nfl/players/**' },
      { protocol: 'https', hostname: 'sleepercdn.com', pathname: '/images/team_logos/**' },
      // Division photos
      { protocol: 'https', hostname: 'sleepercdn.com', pathname: '/uploads/**' },
    ],
  },
};

export default nextConfig;
