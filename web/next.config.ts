import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Basic hardening: no MIME sniffing, no framing by other sites, no full URLs sent to other sites
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
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
